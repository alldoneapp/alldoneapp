// A submission is durable before any Firestore reads start. Keep each item in
// its own key so other tabs cannot overwrite an unrelated pending comment.
export const COMMENT_OUTBOX_PREFIX = 'alldone.commentOutbox.v1:'
const listeners = new Set()
export const subscribeCommentOutbox = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
const notify = () =>
    listeners.forEach(listener => {
        try {
            listener()
        } catch (_) {}
    })

export const createCommentOutbox = ({
    storage = () => window.localStorage,
    now = Date.now,
    sendTimeoutMs = 30000,
} = {}) => {
    const running = new Map()
    const runningChats = new Map()
    let sender
    let activeUser = () => null
    let canSend = () => false
    const key = (userId, id) => `${COMMENT_OUTBOX_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(id)}`
    const read = (userId, id) => {
        try {
            const entry = JSON.parse(storage()?.getItem(key(userId, id)) || 'null')
            return entry?.userId === userId && entry.id === id ? entry : null
        } catch (_) {
            return null
        }
    }
    const save = entry => {
        const target = storage()
        if (!target) throw new Error('Local storage is unavailable. Keep this comment open and try again.')
        // Do not pretend a memory fallback is durable when quota/private mode
        // refuses the write. The composer must keep its text in that case.
        target.setItem(key(entry.userId, entry.id), JSON.stringify(entry))
        notify()
        return entry
    }
    const list = userId => {
        if (!userId) return []
        const entries = []
        try {
            const target = storage()
            for (let i = 0; i < target?.length; i++) {
                const itemKey = target.key(i)
                if (!itemKey?.startsWith(`${COMMENT_OUTBOX_PREFIX}${encodeURIComponent(userId)}:`)) continue
                try {
                    const entry = JSON.parse(target.getItem(itemKey))
                    if (entry?.userId === userId && entry.id && entry.status !== 'sent') entries.push(entry)
                } catch (_) {}
            }
        } catch (_) {}
        return entries.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
    }
    const flushOne = entry => {
        const itemKey = key(entry.userId, entry.id)
        if (running.has(itemKey)) return running.get(itemKey)
        const current = read(entry.userId, entry.id)
        if (!current || current.status === 'sent' || current.status === 'failed' || !canSend(current))
            return Promise.resolve()
        const chatKey = JSON.stringify([current.userId, current.projectId, current.objectType, current.objectId])
        const previous = runningChats.get(chatKey)
        const run = Promise.resolve(previous)
            .catch(() => {})
            .then(async () => {
                if (activeUser() !== current.userId || !canSend(current)) return
                let expired = false
                let timer
                let rejectTimeout
                const timeout = new Promise((_, reject) => {
                    rejectTimeout = reject
                })
                const arm = () => {
                    clearTimeout(timer)
                    timer = setTimeout(() => {
                        expired = true
                        rejectTimeout(Object.assign(new Error('Comment sync timed out'), { code: 'deadline-exceeded' }))
                    }, sendTimeoutMs)
                }
                // AT-2922: a message may wait behind the assistant's previous answer for as long as
                // that answer takes. The sync timeout measures delivery, so it is paused meanwhile.
                const hold = async wait => {
                    clearTimeout(timer)
                    try {
                        return await wait()
                    } finally {
                        if (!expired) arm()
                    }
                }
                arm()
                try {
                    await Promise.race([
                        sender(current, () => !expired && activeUser() === current.userId, { hold }),
                        timeout,
                    ])
                    // A tombstone also protects against removeItem failing after an
                    // acknowledged send. The server transaction deduplicates replay.
                    save({ ...(read(current.userId, current.id) || current), status: 'sent' })
                    try {
                        storage().removeItem(itemKey)
                    } catch (_) {}
                    notify()
                } catch (error) {
                    // The user removed a queued message: nothing is left to keep.
                    if (error?.code === 'removed-by-user') return
                    const permanent = ['permission-denied', 'invalid-argument', 'not-found'].includes(error?.code)
                    // Another tab may already have acknowledged and removed it.
                    const latest = read(current.userId, current.id)
                    if (latest && latest.status !== 'sent') {
                        // A retry waits for its turn in the thread again (AT-2922).
                        const { threadGateCleared, forceSend, ...retryable } = latest
                        save({
                            ...retryable,
                            status: permanent ? 'failed' : 'pending',
                            errorCode: error?.code || 'unavailable',
                        })
                    }
                    throw error
                } finally {
                    expired = true
                    clearTimeout(timer)
                }
            })
        running.set(itemKey, run)
        runningChats.set(chatKey, run)
        run.finally(() => {
            running.delete(itemKey)
            if (runningChats.get(chatKey) === run) runningChats.delete(chatKey)
        }).catch(() => {})
        return run
    }
    return {
        list,
        read,
        enqueue: values => save({ ...values, created: values.created || now(), status: 'pending' }),
        flushOne,
        flush: () => Promise.allSettled(list(activeUser()).map(flushOne)),
        // AT-2922: a queued message is marked, sent at once or removed by the user.
        update: (userId, id, patch) => {
            const entry = read(userId, id)
            return entry && entry.status !== 'sent' ? save({ ...entry, ...patch }) : null
        },
        remove: (userId, id) => {
            const entry = read(userId, id)
            // Only a message still waiting for its turn can be withdrawn; one already being
            // delivered may have reached the server.
            if (!entry || entry.status !== 'queued') return false
            try {
                storage().removeItem(key(userId, id))
            } catch (_) {
                return false
            }
            notify()
            return true
        },
        retry: (userId, id) => {
            const entry = read(userId, id)
            if (entry && activeUser() === userId) return flushOne(save({ ...entry, status: 'pending', errorCode: '' }))
            return Promise.resolve()
        },
        configure: options => {
            sender = options.send
            activeUser = options.activeUser
            canSend = options.canSend
        },
    }
}

export const commentOutbox = createCommentOutbox()
let stopInstalledOutbox

export const installCommentOutbox = (db, auth, store, { subscribeVisible, subscribeHealth, isOffline }) => {
    stopInstalledOutbox?.()
    commentOutbox.configure({
        activeUser: () => {
            const userId = auth.currentUser?.uid
            return userId && userId === store.getState().loggedUser?.uid ? userId : null
        },
        canSend: entry =>
            !isOffline() &&
            store.getState().loggedUser?.uid === entry.userId &&
            !!store.getState().loggedUserProjectsMap?.[entry.projectId],
        send: async (entry, isActive, controls) => {
            // New tasks and their access projections may still be in the SDK's
            // original queue. Wait for them without ever replaying those writes.
            await db.waitForPendingWrites()
            if (!isActive()) throw Object.assign(new Error('Account changed'), { code: 'cancelled' })
            const { sendQueuedObjectMessage } = require('./chatsComments')
            await sendQueuedObjectMessage(entry, isActive, controls)
        },
    })
    const flush = () => void commentOutbox.flush()
    const stopAuth = auth.onAuthStateChanged(flush)
    const stopVisible = subscribeVisible(flush)
    const stopHealth = subscribeHealth(flush)
    const timer = setInterval(flush, 15000)
    window.addEventListener('online', flush)
    window.addEventListener('storage', notify)
    flush()
    stopInstalledOutbox = () => {
        clearInterval(timer)
        stopAuth()
        stopVisible()
        stopHealth()
        window.removeEventListener('online', flush)
        window.removeEventListener('storage', notify)
    }
    return stopInstalledOutbox
}
