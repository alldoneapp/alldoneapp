import { subscribePageHidden } from '../../utils/appResume'

const PREFIX = 'alldone.annaMessages.v1:'
const MAX_THREADS = 6
const MAX_MESSAGES = 50
const MAX_CHARS = 1024 * 1024
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const validScope = ({ userId, projectId, objectId, chatType }) =>
    validId(userId) &&
    validId(projectId) &&
    chatType === 'topics' &&
    (objectId === `anna_${userId}` || new RegExp(`^AnnaChat[0-9]{8}${userId}$`).test(objectId))
const threadKey = scope => `${scope.projectId}/${scope.objectId}`

// A bounded first-paint snapshot, not a second source of truth. Firestore still
// owns live messages, including authoritative edits/deletions and access checks.
export const createAnnaMessageCache = (getStorage = () => localStorage) => {
    const records = new Map()
    const dirty = new Set()
    let timer, stopHidden
    const readRecord = userId => {
        if (!records.has(userId)) {
            let saved
            try {
                saved = JSON.parse(getStorage().getItem(PREFIX + userId) || 'null')
            } catch (_) {}
            records.set(
                userId,
                saved?.userId === userId &&
                    saved?.threads &&
                    typeof saved.threads === 'object' &&
                    !Array.isArray(saved.threads)
                    ? saved
                    : { userId, threads: {} }
            )
        }
        return records.get(userId)
    }
    const flush = () => {
        clearTimeout(timer)
        timer = undefined
        stopHidden?.()
        stopHidden = null
        if (typeof window !== 'undefined') window.removeEventListener('beforeunload', flush)
        for (const userId of dirty) {
            try {
                const record = readRecord(userId)
                let value = JSON.stringify(record)
                while (value.length > MAX_CHARS && Object.keys(record.threads).length) {
                    const oldest = Object.keys(record.threads).sort(
                        (a, b) => (record.threads[a]?.savedAt || 0) - (record.threads[b]?.savedAt || 0)
                    )[0]
                    delete record.threads[oldest]
                    value = JSON.stringify(record)
                }
                getStorage().setItem(PREFIX + userId, value)
            } catch (_) {
                /* Restricted/full storage must not break live chat. */
            }
        }
        dirty.clear()
    }
    const schedule = userId => {
        dirty.add(userId)
        if (timer !== undefined) return
        timer = setTimeout(flush, 500)
        stopHidden = subscribePageHidden(flush)
        if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush)
    }
    return {
        read(scope) {
            if (!validScope(scope)) return null
            const entry = readRecord(scope.userId).threads[threadKey(scope)]
            if (!Array.isArray(entry?.messages) || entry.messages.some(message => !validId(message?.id))) return null
            return entry.messages.slice(-Math.min(scope.limit || MAX_MESSAGES, MAX_MESSAGES))
        },
        write(scope, messages) {
            if (!validScope(scope)) return
            const record = readRecord(scope.userId)
            // Preserve write order when several thread snapshots share a millisecond.
            delete record.threads[threadKey(scope)]
            record.threads[threadKey(scope)] = { savedAt: Date.now(), messages: messages.slice(-MAX_MESSAGES) }
            const keys = Object.keys(record.threads)
                .reverse()
                .sort((a, b) => (record.threads[b]?.savedAt || 0) - (record.threads[a]?.savedAt || 0))
            keys.slice(MAX_THREADS).forEach(key => delete record.threads[key])
            schedule(scope.userId)
        },
        remove(scope) {
            if (!validScope(scope)) return
            delete readRecord(scope.userId).threads[threadKey(scope)]
            schedule(scope.userId)
            flush()
        },
        flush,
    }
}

export const annaMessageCache = createAnnaMessageCache()
