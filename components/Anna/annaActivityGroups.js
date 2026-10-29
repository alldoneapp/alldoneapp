import { isAnnaNavigationPath } from './annaNavigation'

// Activity on one object tends to arrive in bursts: a task completed and a result posted in its
// chat, a note saved twice within a minute. One row per object keeps every arrival (each is still
// its own saved notice and its own assistant context entry) but shows the object only once (AT-2906).
export const ANNA_ACTIVITY_GROUP_WINDOW_MS = 10 * 60 * 1000

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)

// feed/{projectId}/{objectType}/{objectId}/{feedId} and chat/{projectId}/{chatId}/{commentId}.
// For a task, note, goal or contact the chat id IS the object id, so both kinds meet on one key.
export const getAnnaActivityObject = notice => {
    const parts = typeof notice?.id === 'string' ? notice.id.split('/') : []
    if (notice?.kind === 'feed' && parts.length === 5)
        return { projectId: parts[1], objectType: parts[2], objectId: parts[3] }
    if (notice?.kind === 'chat' && parts.length === 4)
        return {
            projectId: parts[1],
            objectType: notice.content?.objectType || notice.source?.chatType || '',
            objectId: parts[2],
        }
    return null
}

const objectKey = notice => {
    const object = getAnnaActivityObject(notice)
    return object ? `${object.projectId}/${object.objectId}` : `notice/${notice.id}`
}

// Groups only notices that sit next to each other in the timeline: a message in between ends
// the group, so the conversation keeps its order and nothing moves past a reply.
export function groupAnnaTimeline(timeline, windowMs = ANNA_ACTIVITY_GROUP_WINDOW_MS) {
    const result = []
    timeline.forEach(entry => {
        if (!entry.notice?.kind) {
            result.push(entry)
            return
        }
        const previous = result[result.length - 1]
        const lastNotice = previous?.notices?.[previous.notices.length - 1]
        if (
            lastNotice &&
            objectKey(lastNotice) === objectKey(entry.notice) &&
            entry.notice.created - lastNotice.created <= windowMs
        ) {
            previous.notices.push(entry.notice)
            return
        }
        result.push({ notices: [entry.notice], created: entry.created })
    })
    return result
}

const DETAIL_PATHS = {
    tasks: (projectId, id, chat) => `/projects/${projectId}/tasks/${id}/${chat ? 'chat' : 'properties'}`,
    goals: (projectId, id, chat) => `/projects/${projectId}/goals/${id}/${chat ? 'chat' : 'properties'}`,
    notes: (projectId, id) => `/projects/${projectId}/notes/${id}/editor`,
    contacts: (projectId, id) => `/projects/${projectId}/contacts/${id}/properties`,
}

// Open the object itself; a new message opens its chat. Objects the workspace cannot show
// directly (topics, users, skills, …) keep the followed inbox they always linked to.
export function getAnnaActivityTarget(notices) {
    const last = notices[notices.length - 1]
    const object = getAnnaActivityObject(last)
    const build = object && DETAIL_PATHS[object.objectType]
    if (build && validId(object.projectId) && validId(object.objectId)) {
        const path = build(
            object.projectId,
            object.objectId,
            notices.some(notice => notice.kind === 'chat')
        )
        if (isAnnaNavigationPath(path)) return path
    }
    return last.path
}
