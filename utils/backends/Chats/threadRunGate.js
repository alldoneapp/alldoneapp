// AT-2922 — one conversation, one assistant turn at a time.
//
// A message that asks the assistant for an answer is held while the previous answer in the same
// thread is still being produced, and is only written into the thread once that answer is
// complete. "Complete" means the whole run, including tool rounds, and also a VM job the run
// started in that thread (product decision: a queued message waits for the VM too). Other
// conversations are never blocked: everything here is keyed by thread.
//
// Three signals say "still processing", and each covers a gap the others cannot see:
//
// 1. Runs this tab started itself (`beginThreadRun`/`settleThreadRun`). They cover the seconds
//    between sending a request and the server creating the assistant's comment (cold start).
// 2. A comment in the thread that is still being written: a chat run's comment while its
//    `assistantRun.status` is live, and a VM status comment while its job is queued, running,
//    waiting for the user or being cancelled. This is what makes other tabs, other devices and
//    other members' runs count.
// 3. A user message that recorded an assistant run request (`assistantRunRequest`) and has no
//    answer after it yet. That is the cold-start gap of a run another tab or device started.
//
// Every signal expires, so a crashed run or a lost listener can delay a message but never strand
// it: the comment watchdog settles a stuck chat run after ~61 minutes, and the bounds below sit
// above every legitimate run length. The user can also send a queued message at once or remove
// it, which is the escape for a VM job that runs for hours.

export const LIVE_RUN_STATUSES = ['running', 'cancel_requested', 'queued', 'awaiting_user']
export const PENDING_RUN_GRACE_MS = 150 * 1000
export const CHAT_RUN_STALE_MS = 70 * 60 * 1000
export const VM_RUN_STALE_MS = 6 * 60 * 60 * 1000
export const VM_INTERACTION_STALE_MS = 25 * 60 * 60 * 1000
export const LOCAL_RUN_STALE_MS = 65 * 60 * 1000
export const SNAPSHOT_SETTLE_MS = 4000
export const RECHECK_INTERVAL_MS = 5000
const RECENT_COMMENTS = 5
const SETTLED_IDS_LIMIT = 200

export const toMillis = value => {
    if (!value) return 0
    if (typeof value === 'number') return value
    if (typeof value.toMillis === 'function') return value.toMillis()
    if (value.seconds !== undefined) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6)
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

export const getThreadRunKey = ({ projectId, objectType, objectId } = {}) =>
    JSON.stringify([projectId || '', objectType || 'tasks', objectId || ''])

export const isCommentStillProcessing = (comment, now) => {
    if (!comment || typeof comment !== 'object') return false
    const run = comment.assistantRun
    const live = run?.status
        ? LIVE_RUN_STATUSES.includes(run.status)
        : comment.isLoading === true || comment.isThinking === true || comment.isPartial === true
    if (!live) return false
    const lastChange = toMillis(comment.lastChangeDate) || toMillis(comment.created)
    if (!lastChange) return true
    const maxAge =
        run?.status === 'awaiting_user'
            ? VM_INTERACTION_STALE_MS
            : run?.kind === 'vm_job'
              ? VM_RUN_STALE_MS
              : CHAT_RUN_STALE_MS
    return now - lastChange <= maxAge
}

const isAnswer = comment => comment?.fromAssistant === true || !!comment?.assistantRun

export const isAssistantRunRequestPending = (comments, now, settledIds = new Set(), excludeId = null) => {
    const newest = [...(comments || [])]
        .filter(comment => comment && comment.id !== excludeId)
        .sort((a, b) => toMillis(b.created) - toMillis(a.created))[0]
    if (!newest || isAnswer(newest) || !newest.assistantRunRequest || settledIds.has(newest.id)) return false
    const created = toMillis(newest.created)
    return !!created && now - created < PENDING_RUN_GRACE_MS
}

export const evaluateThreadBusy = ({ localRuns = [], comments = [], now, settledIds, excludeId = null }) =>
    localRuns.some(startedAt => now - startedAt < LOCAL_RUN_STALE_MS) ||
    comments.some(comment => comment?.id !== excludeId && isCommentStillProcessing(comment, now)) ||
    isAssistantRunRequestPending(comments, now, settledIds, excludeId)

// The released message must sort after everything already in the thread, whatever the device
// clocks say: the answer it waited for was timestamped by the server.
export const getReleasedMessageCreated = ({ comments = [], now, originalCreated = 0, waited, excludeId = null }) => {
    const latest = comments.reduce(
        (max, comment) => (comment?.id === excludeId ? max : Math.max(max, toMillis(comment?.created))),
        0
    )
    return Math.max(waited ? now : originalCreated || now, latest ? latest + 1 : 0)
}

// Deliberately the plain client clock: utils/serverClock imports the redux store, which is far too
// heavy to pull into the send path, and the ordering does not depend on it, because a released
// message is always dated after the newest comment the thread already holds.
const defaultNow = () => Date.now()

const defaultWatchThread = (thread, onUpdate) => {
    const { getDb } = require('../firestore')
    const base = getDb().collection(`chatComments/${thread.projectId}/${thread.objectType}/${thread.objectId}/comments`)
    const state = { recent: [], live: [], recentReady: false, liveReady: false }
    const listen = (query, field) =>
        query.onSnapshot(
            { includeMetadataChanges: true },
            snapshot => {
                const comments = []
                snapshot.forEach(doc => comments.push({ ...doc.data(), id: doc.id }))
                state[field] = comments
                if (!snapshot.metadata?.fromCache) state[`${field}Ready`] = true
                onUpdate(state)
            },
            () => {
                // Without data the gate falls back to this tab's own runs; it must not hold forever.
                state[field] = []
                state[`${field}Ready`] = true
                onUpdate(state)
            }
        )
    const stops = [
        listen(base.orderBy('created', 'desc').limit(RECENT_COMMENTS), 'recent'),
        listen(base.where('assistantRun.status', 'in', LIVE_RUN_STATUSES), 'live'),
    ]
    return () => stops.forEach(stop => stop?.())
}

export const createThreadRunGate = ({
    now = defaultNow,
    watchThread = defaultWatchThread,
    setTimer = (fn, ms) => setInterval(fn, ms),
    clearTimer = id => clearInterval(id),
} = {}) => {
    const localRuns = new Map() // key -> Map(runId -> startedAt)
    const settledIds = new Set()
    const watchers = new Map() // key -> { state, refs, stop, listeners }
    const pokes = new Set()
    const poke = () => pokes.forEach(fn => fn())

    const runsFor = key => [...(localRuns.get(key)?.values() || [])]
    const commentsOf = state => [...(state?.recent || []), ...(state?.live || [])]

    const acquire = (thread, key, listener) => {
        let watcher = watchers.get(key)
        if (!watcher) {
            watcher = { state: { recent: [], live: [] }, ready: false, refs: 0, listeners: new Set(), stop: null }
            watchers.set(key, watcher)
            try {
                watcher.stop = watchThread(thread, state => {
                    watcher.state = state
                    watcher.ready = state.recentReady !== false && state.liveReady !== false
                    watcher.listeners.forEach(fn => fn())
                })
            } catch (_) {
                watcher.ready = true
            }
        }
        watcher.refs++
        watcher.listeners.add(listener)
        return () => {
            watcher.listeners.delete(listener)
            if (--watcher.refs > 0) return
            watchers.delete(key)
            try {
                watcher.stop?.()
            } catch (_) {}
        }
    }

    const beginThreadRun = (thread, runId) => {
        if (!thread?.objectId || !runId) return
        const key = getThreadRunKey(thread)
        if (!localRuns.has(key)) localRuns.set(key, new Map())
        localRuns.get(key).set(runId, now())
        poke()
    }

    const settleThreadRun = (thread, runId) => {
        if (!runId) return
        settledIds.add(runId)
        if (settledIds.size > SETTLED_IDS_LIMIT) settledIds.delete(settledIds.values().next().value)
        const key = thread?.objectId ? getThreadRunKey(thread) : null
        const keys = key ? [key] : [...localRuns.keys()]
        keys.forEach(item => {
            localRuns.get(item)?.delete(runId)
            if (localRuns.get(item)?.size === 0) localRuns.delete(item)
        })
        poke()
    }

    const isThreadBusyLocally = thread => {
        const key = getThreadRunKey(thread)
        const current = now()
        return evaluateThreadBusy({
            localRuns: runsFor(key),
            comments: commentsOf(watchers.get(key)?.state),
            now: current,
            settledIds,
        })
    }

    // Resolves once the thread is free:
    //   { status: 'idle' | 'released' | 'cancelled', waited, created }
    // `released` = the user chose "send now", `cancelled` = the user removed the message.
    // Rejects with code 'cancelled' when `isActive` turns false (account switch, unmount).
    const waitForThreadIdle = (
        thread,
        {
            isActive = () => true,
            shouldCancel = () => false,
            shouldRelease = () => false,
            onQueued = null,
            subscribe = null,
            excludeId = null,
            originalCreated = 0,
        } = {}
    ) =>
        new Promise((resolve, reject) => {
            const key = getThreadRunKey(thread)
            const startedAt = Date.now()
            let waited = false
            let done = false
            let release = () => {}
            let unsubscribe = null
            let timer = null
            const finish = (fn, value) => {
                if (done) return
                done = true
                release()
                pokes.delete(evaluate)
                unsubscribe?.()
                if (timer) clearTimer(timer)
                fn(value)
            }
            const evaluate = () => {
                if (done) return
                if (!isActive()) {
                    finish(reject, Object.assign(new Error('Account changed'), { code: 'cancelled' }))
                    return
                }
                const watcher = watchers.get(key)
                const comments = commentsOf(watcher?.state)
                const current = now()
                const result = status => ({
                    status,
                    waited,
                    created: getReleasedMessageCreated({ comments, now: current, originalCreated, waited, excludeId }),
                })
                if (shouldCancel()) return finish(resolve, result('cancelled'))
                if (shouldRelease()) return finish(resolve, result('released'))
                const busy = evaluateThreadBusy({
                    localRuns: runsFor(key),
                    comments,
                    now: current,
                    settledIds,
                    excludeId,
                })
                if (busy) {
                    if (!waited) {
                        waited = true
                        try {
                            onQueued?.()
                        } catch (_) {}
                    }
                    return
                }
                if (!watcher?.ready && Date.now() - startedAt < SNAPSHOT_SETTLE_MS) return
                finish(resolve, result('idle'))
            }
            pokes.add(evaluate)
            release = acquire(thread, key, evaluate)
            unsubscribe = subscribe ? subscribe(evaluate) : null
            timer = setTimer(evaluate, RECHECK_INTERVAL_MS)
            // A not-yet-ready snapshot must not delay an idle thread beyond the settle window.
            setTimeout(evaluate, SNAPSHOT_SETTLE_MS + 10)
            evaluate()
        })

    // Tests share the module singleton; production never calls this.
    const reset = () => {
        localRuns.clear()
        settledIds.clear()
        poke()
    }

    return {
        reset,
        beginThreadRun,
        settleThreadRun,
        isThreadBusyLocally,
        waitForThreadIdle,
        notify: poke,
    }
}

export const threadRunGate = createThreadRunGate()
