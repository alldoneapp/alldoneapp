const CACHE_VERSION = 1
export const ASSISTANT_LINE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

const TASKS_PREFIX = 'alldone_assistant_line_tasks'
const COMMENT_PREFIX = 'alldone_assistant_line_comment'

const cacheIsAvailable = () => typeof localStorage !== 'undefined'
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const keyPart = value => encodeURIComponent(String(value || ''))
const buildKey = (prefix, parts) => `${prefix}:v${CACHE_VERSION}:${parts.map(keyPart).join(':')}`

export const getAssistantTasksCacheKey = ({ userId, projectId, assistantId }) =>
    buildKey(TASKS_PREFIX, [userId, projectId, assistantId])

export const getLastCommentCacheKey = ({ userId, projectId, objectType, objectId }) =>
    buildKey(COMMENT_PREFIX, [userId, projectId, objectType, objectId])

const readEntry = key => {
    if (!cacheIsAvailable()) return null

    try {
        const rawValue = localStorage.getItem(key)
        if (!rawValue) return null

        const entry = JSON.parse(rawValue)
        if (entry?.version !== CACHE_VERSION || !Number.isFinite(entry.savedAt)) {
            localStorage.removeItem(key)
            return null
        }
        if (!isOffline() && Date.now() - entry.savedAt > ASSISTANT_LINE_CACHE_MAX_AGE_MS) {
            localStorage.removeItem(key)
            return null
        }
        return entry
    } catch (error) {
        localStorage.removeItem(key)
        return null
    }
}

const writeEntry = (key, data) => {
    if (!cacheIsAvailable()) return false

    try {
        localStorage.setItem(
            key,
            JSON.stringify({
                version: CACHE_VERSION,
                savedAt: Date.now(),
                ...data,
            })
        )
        return true
    } catch (error) {
        return false
    }
}

export const readAssistantTasksCache = context => {
    if (!context?.userId || !context?.projectId || !context?.assistantId) return null
    const entry = readEntry(getAssistantTasksCacheKey(context))
    return Array.isArray(entry?.tasks) ? entry.tasks : null
}

export const writeAssistantTasksCache = (context, tasks) => {
    if (!context?.userId || !context?.projectId || !context?.assistantId || !Array.isArray(tasks)) return false
    return writeEntry(getAssistantTasksCacheKey(context), { tasks })
}

export const readLastCommentCache = context => {
    if (!context?.userId || !context?.projectId || !context?.objectType || !context?.objectId) return null
    const entry = readEntry(getLastCommentCacheKey(context))
    if (typeof entry?.commentText !== 'string' || !entry.chat || typeof entry.chat !== 'object') return null
    return { commentText: entry.commentText, chat: entry.chat }
}

export const writeLastCommentCache = (context, { commentText, chat }) => {
    if (
        !context?.userId ||
        !context?.projectId ||
        !context?.objectType ||
        !context?.objectId ||
        typeof commentText !== 'string' ||
        !chat ||
        typeof chat !== 'object'
    )
        return false

    // The preview reads only these two fields. Keeping the cache deliberately
    // small avoids duplicating the complete chat document outside Firestore's
    // own offline store.
    return writeEntry(getLastCommentCacheKey(context), {
        commentText,
        chat: {
            title: typeof chat.title === 'string' ? chat.title : '',
            assistantId: typeof chat.assistantId === 'string' ? chat.assistantId : '',
        },
    })
}
