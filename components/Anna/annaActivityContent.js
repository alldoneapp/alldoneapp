import { getDb } from '../../utils/backends/firestore'
import store from '../../redux/store'
import { getAssistantAuthorProjectIds, getAssistantFromState } from '../AdminPanel/Assistants/assistantStateLookup'
import { findAssistantAuthor } from '../../utils/backends/Assistants/assistantAuthorLookup'
import { getFeedObjectDate, getFeedObjectDateCandidates } from '../../utils/backends/Feeds/feedObjectDate'
import { annaActivityPreview } from './annaActivityText'
import * as types from '../Feeds/Utils/FeedsConstants'

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const objectTypes = new Set([
    'tasks',
    'notes',
    'goals',
    'topics',
    'contacts',
    'users',
    'skills',
    'assistants',
    'projects',
    'customs',
])
const nameOf = object => annaActivityPreview(object?.name || object?.title || object?.displayName, 160)

function cachedAuthor(id) {
    const state = store.getState()
    return (
        (state.loggedUser?.uid === id ? state.loggedUser : null) ||
        getAssistantFromState(state, id) ||
        Object.values(state.projectUsers || {})
            .flat()
            .find(user => user?.uid === id) ||
        Object.values(state.projectContacts || {})
            .flat()
            .find(contact => contact?.uid === id)
    )
}

// All lookups here are read-only. In particular, do not use getFeedObject: its missing-object
// fallback repairs feed documents, and a notification preview must never perform those writes.
async function readAnnaActivityContent(notice, userId) {
    const state = store.getState()
    if (state.loggedUser?.uid !== userId) return null
    const parts = notice.id.split('/')
    const [, projectId, objectOrChatId, lastId, feedId] = parts
    if (!validId(projectId) || parts.some((part, index) => index > 1 && !validId(part))) return null
    const reads = new Map()
    const read = path => {
        if (store.getState().loggedUser?.uid !== userId) throw new Error('Account changed')
        if (!reads.has(path))
            reads.set(
                path,
                getDb()
                    .doc(path)
                    .get()
                    .then(snapshot => snapshot.data())
            )
        return reads.get(path)
    }
    const author = async (id, fromAssistant = false) => {
        if (!validId(id) || store.getState().loggedUser?.uid !== userId) return ''
        const cached = cachedAuthor(id)
        if (cached) return nameOf(cached)
        const results = await Promise.allSettled([
            fromAssistant ? null : read(`users/${id}`),
            findAssistantAuthor(id, getAssistantAuthorProjectIds(state), userId),
        ])
        return nameOf(results.find(result => result.status === 'fulfilled' && result.value)?.value)
    }
    const content = { version: 1, objectName: '', actorName: '', preview: '' }

    if (notice.kind === 'chat' && parts.length === 4) {
        const chat = await read(`chatObjects/${projectId}/chats/${objectOrChatId}`)
        const chatType = notice.source?.chatType || chat?.type
        if (!objectTypes.has(chatType)) return null
        const message = await read(`chatComments/${projectId}/${chatType}/${objectOrChatId}/comments/${lastId}`)
        if (!message) return null
        content.objectName = nameOf(chat)
        content.preview = annaActivityPreview(message?.previewText || message?.commentText)
        content.actorName = await author(
            message?.creatorId || notice.source?.creatorId,
            message?.fromAssistant || notice.source?.creatorType === 'assistant'
        )
        return content
    }

    if (notice.kind !== 'feed' || parts.length !== 5 || !objectTypes.has(objectOrChatId)) return null
    const feed = notice.source || (await read(`feedsStore/${projectId}/all/${feedId}`))
    if (!feed) return null
    let object
    for (const date of getFeedObjectDateCandidates(getFeedObjectDate(feed), feed.lastChangeDate || notice.occurredAt)) {
        // A missing day can read as permission-denied. Try the writer's UTC day as the feed UI does.
        try {
            object = await read(`projectsFeeds/${projectId}/${date}/${lastId}`)
        } catch (_) {}
        if (object) break
    }
    if (!object) object = await read(`feedsObjectsLastStates/${projectId}/${objectOrChatId}/${lastId}`)
    content.objectName = nameOf(object)
    content.actorName = await author(feed.creatorId)

    if (feed.entryText) {
        content.entryText = feed.entryText
    } else if (
        [
            types.FEED_TASK_PROJECT_CHANGED_TO,
            types.FEED_TASK_PROJECT_CHANGED_FROM,
            types.FEED_NOTE_PROJECT_CHANGED_TO,
            types.FEED_NOTE_PROJECT_CHANGED_FROM,
        ].includes(feed.type)
    ) {
        content.actionKey =
            feed.changeDirection === 'from' ? 'Anna activity moved from project' : 'Anna activity moved to project'
        content.actionParams = { name: annaActivityPreview(feed.projectName, 160) }
    } else if (feed.type === types.FEED_TASK_PARENT_GOAL) {
        content.actionKey = feed.newParentGoalId ? 'Anna activity goal changed' : 'Anna activity unlinked goal'
        if (validId(feed.newParentGoalId)) {
            const goal = await read(`goals/${projectId}/items/${feed.newParentGoalId}`).catch(() => null)
            if (nameOf(goal)) {
                content.actionKey = 'Anna activity linked goal'
                content.actionParams = { name: nameOf(goal) }
            }
        }
    } else if (feed.type === types.FEED_TASK_ASSIGNEE_CHANGED || feed.type === types.FEED_NOTE_OWNER_CHANGED) {
        content.actionKey = 'Anna activity assigned to'
        content.actionParams = { name: await author(feed.newAssigneeId || feed.newOwnerId) }
    } else if (feed.type === types.FEED_TASK_MOVED_IN_WORKFLOW) {
        content.actionKey = 'Anna activity workflow changed'
        content.actionParams = {
            from: annaActivityPreview(feed.fromStepDescription, 80),
            to: annaActivityPreview(feed.toStepDescription, 80),
        }
    } else {
        content.actionKey = 'Anna activity item updated'
    }
    if (content.actionParams?.name === '') {
        content.actionKey = 'Anna activity item updated'
        delete content.actionParams
    }
    return content
}

// Older saved rows are enriched only when their conversation is rendered. Bound the reads when
// opening a busy day; never subscribe to every historical thread or load entire conversations.
const pending = new Map()
const queue = []
let running = 0
const drain = () => {
    while (running < 4 && queue.length) {
        running++
        const run = queue.shift()
        run().finally(() => {
            running--
            drain()
        })
    }
}
export function loadAnnaActivityContent(notice, userId) {
    const key = `${userId}/${notice.id}`
    if (!pending.has(key)) {
        const request = new Promise(resolve => {
            queue.push(async () => {
                try {
                    resolve(await readAnnaActivityContent(notice, userId))
                } catch (_) {
                    // Missing, private, or temporarily offline content leaves the useful fallback
                    // intact. Reopening/reconnecting can try again; never lose the arrival itself.
                    resolve(null)
                }
            })
        }).finally(() => pending.delete(key))
        pending.set(key, request)
        drain()
    }
    return pending.get(key)
}
