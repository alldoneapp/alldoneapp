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

// AT-3087: every card names what it is about with a small grey icon left of its title. The icons
// are the ones the chat list already uses per object type (`getChatIcon`), so a task reads as a
// task everywhere. They are object types only: what happened (completed, a reply) stays the blue
// labels at the bottom, and read state stays the red edge and the ✓✓ button.
export const ANNA_ACTIVITY_TYPES = {
    tasks: { icon: 'check-square', label: 'Anna activity type tasks' },
    notes: { icon: 'file-text', label: 'Anna activity type notes' },
    goals: { icon: 'target', label: 'Anna activity type goals' },
    topics: { icon: 'comments-thread', label: 'Anna activity type topics' },
    contacts: { icon: 'user', label: 'Anna activity type contacts' },
    users: { icon: 'users', label: 'Anna activity type users' },
    skills: { icon: 'star', label: 'Anna activity type skills' },
    assistants: { icon: 'cpu', label: 'Anna activity type assistants' },
    artifacts: { icon: 'layers', label: 'Anna activity type artifacts' },
    projects: { icon: 'folder', label: 'Anna activity type projects' },
    // A chat message whose thread type is not known (yet): still a chat.
    chat: { icon: 'comments-thread', label: 'Anna activity type chat' },
    // Anything else (custom objects, a notice without an object): a notification.
    update: { icon: 'bell', label: 'Anna activity type update' },
}

// The type of a card: the object type any notice of the group knows (a feed notice always does,
// a chat notice once enriched or when its source saved the chat type), else chat or update.
export function getAnnaActivityType(notices) {
    const known = [...notices]
        .reverse()
        .map(getAnnaActivityObject)
        .find(object => object?.objectType && ANNA_ACTIVITY_TYPES[object.objectType])
    const type = known?.objectType || (notices.some(notice => notice?.kind === 'chat') ? 'chat' : 'update')
    return { type, ...ANNA_ACTIVITY_TYPES[type] }
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
    // AT-3066: "Created artifact" (and every other artifact update) opens the artifact itself, a
    // message in its chat opens that chat, never the followed updates inbox.
    artifacts: (projectId, id, chat) => `/projects/${projectId}/artifacts/${id}${chat ? '/chat' : ''}`,
    // A topic IS its chat.
    topics: (projectId, id) => `/projects/${projectId}/chats/${id}/chat`,
}

// The chat object of any thread. Its type is resolved when the row is opened
// (`resolveAnnaActivityPath`), so an activity row never needs the followed chats inbox.
export const getAnnaChatObjectPath = (projectId, chatId) => `/projects/${projectId}/chats/${chatId}/chat`

// Open the object itself; a new message opens its chat. A chat message whose thread type is not
// known yet (saved before it was enriched) opens its own chat object, never the followed chats
// inbox: that list is not the object, and routing there looked the target user up in a project
// whose members may not be loaded yet (AT-2906). Objects the workspace cannot show directly
// (users, skills, …) keep the followed updates inbox they always linked to.
export function getAnnaActivityTarget(notices) {
    const last = notices[notices.length - 1]
    const objects = notices.map(getAnnaActivityObject)
    const object = objects[objects.length - 1]
    if (object && validId(object.projectId) && validId(object.objectId)) {
        // Every notice of a group is the same object; a feed notice always knows its type.
        const objectType =
            [...objects].reverse().find(candidate => candidate && DETAIL_PATHS[candidate.objectType])?.objectType ||
            object.objectType
        const build = DETAIL_PATHS[objectType]
        const chat = notices.some(notice => notice.kind === 'chat')
        const path = build
            ? build(object.projectId, object.objectId, chat)
            : last.kind === 'chat' && !objectType
              ? getAnnaChatObjectPath(object.projectId, object.objectId)
              : null
        if (path && isAnnaNavigationPath(path)) return path
    }
    return last.path
}
