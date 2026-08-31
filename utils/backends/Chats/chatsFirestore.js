import TasksHelper, { GENERIC_CHAT_TYPE } from '../../../components/TaskListView/Utils/TasksHelper'
import {
    getDb,
    getObjectFollowersIds,
    globalWatcherUnsub,
    mapUserData,
    runHttpsCallableFunction,
    trackStickyNote,
    untrackStickyNote,
} from '../firestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import { updateNotePrivacy, updateNoteTitleWithoutFeed } from '../Notes/notesFirestore'
import { createGenericTaskWhenMention } from '../Tasks/tasksFirestore'
import store from '../../../redux/store'

export const watchChat = (projectId, chatId, watcherKey, callback) => {
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`chatObjects/${projectId}/chats/${chatId}`)
        .onSnapshot(doc => {
            const chat = doc.data()
            if (chat) chat.id = doc.id
            callback(chat)
        })
}

export const updateChatEditionData = async (projectId, chatId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`chatObjects/${projectId}/chats/${chatId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

export async function updateChatData(projectId, chatId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`chatObjects/${projectId}/chats/${chatId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export const updateChatNote = async (projectId, chatId, noteId) => {
    await updateChatData(projectId, chatId, { noteId }, null)
}

export async function updateChatPrivacy(projectId, objectId, objectType, isPublicFor) {
    const batch = new BatchWrapper(getDb())
    const followersIds = await getObjectFollowersIds(projectId, 'topics', objectId)

    await getDb()
        .doc(`chatObjects/${projectId}/chats/${objectId}`)
        .get()
        .then(doc => {
            if (doc.exists) {
                updateChatData(
                    projectId,
                    objectId,
                    {
                        isPublicFor,
                        usersFollowing: isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                            ? [...followersIds]
                            : isPublicFor.filter(userId => followersIds.includes(userId)),
                    },
                    batch
                )

                if (doc.data().noteId) {
                    getObjectFollowersIds(projectId, 'topics', doc.id).then(followersIds => {
                        updateNotePrivacy(
                            projectId,
                            doc.data().noteId,
                            !isPublicFor.includes(FEED_PUBLIC_FOR_ALL),
                            isPublicFor,
                            followersIds,
                            true,
                            null
                        )
                    })
                }
            }
        })
    batch.commit()
}

export function updateChatTitle(projectId, chat, newChatTitle) {
    updateChatData(projectId, chat.id, { title: newChatTitle }, null)
    if (chat.noteId) {
        updateNoteTitleWithoutFeed(projectId, chat.noteId, newChatTitle)
    }
    const mentionedUserIds = TasksHelper.getMentionIdsFromTitle(newChatTitle)
    createGenericTaskWhenMention(projectId, chat.id, mentionedUserIds, GENERIC_CHAT_TYPE, 'topics', chat.assistantId)
}

export async function updateChatAssistant(projectId, chatId, assistantId) {
    console.log('[chatsFirestore] updateChatAssistant called:', {
        projectId,
        chatId,
        assistantId,
    })
    await updateChatData(projectId, chatId, { assistantId }, null)
}

export async function updateChatTitleWithoutFeeds(projectId, chatId, newChatTitle, externalBatch) {
    const doc = await getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).get()
    if (doc.exists) {
        const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
        updateChatData(projectId, chatId, { title: newChatTitle }, batch)
        !externalBatch && batch.commit()
    }
}

export async function updateChatAssistantWithoutFeeds(projectId, chatId, assistantId, externalBatch) {
    const doc = await getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).get()
    if (doc.exists) {
        const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
        updateChatData(projectId, chatId, { assistantId }, batch)
        if (!externalBatch) await batch.commit()
    }
}

export function updateChatHighlight(projectId, chatId, hasStar) {
    updateChatData(projectId, chatId, { hasStar }, null)
}

export async function setChatTopicHighlight(projectId, chatId, highlightColor) {
    await updateChatData(projectId, chatId, { hasStar: highlightColor }, null)
}

export async function moveChatOnMoveObjectFromProject(
    oldProjectId,
    newProjectId,
    objectType,
    chatId,
    beforeDeleteSource
) {
    if (oldProjectId === newProjectId) return

    const { loggedUser, loggedUserProjectsMap } = store.getState()

    const sourceChatRef = getDb().doc(`chatObjects/${oldProjectId}/chats/${chatId}`)
    let chatData

    if (objectType === 'topics') {
        const chat = await sourceChatRef.get()
        if (!chat.exists) return

        chatData = { ...chat.data() }
        delete chatData.movingToOtherProjectId

        const newProjectUserIds = loggedUserProjectsMap[newProjectId]?.userIds || []
        const allowedUserIds = new Set(newProjectUserIds)
        const sourceFollowers = await getDb().doc(`followers/${oldProjectId}/topics/${chatId}`).get()
        const sourceFollowerIds = sourceFollowers.exists
            ? sourceFollowers.data().usersFollowing || []
            : chatData.usersFollowing || []
        const followerIds = sourceFollowerIds.filter(userId => allowedUserIds.has(userId))

        if (allowedUserIds.has(loggedUser.uid) && !followerIds.includes(loggedUser.uid)) {
            followerIds.push(loggedUser.uid)
        }

        chatData.usersFollowing = followerIds
        if (Array.isArray(chatData.members)) {
            chatData.members = chatData.members.filter(userId => allowedUserIds.has(userId))
        }
        if (!chatData.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) {
            chatData.isPublicFor = chatData.isPublicFor.filter(userId => allowedUserIds.has(userId))
            if (allowedUserIds.has(loggedUser.uid) && !chatData.isPublicFor.includes(loggedUser.uid)) {
                chatData.isPublicFor.push(loggedUser.uid)
            }
        }
    }

    // Comments retain their original creatorId. Recreating a teammate's or assistant's
    // comment from the browser would correctly be rejected as impersonation, so the
    // authenticated callable verifies both project memberships and copies the conversation
    // with the Admin SDK. It also owns source cleanup and follower/pointer maintenance,
    // so chatless object moves never have to probe a nonexistent client-readable document.
    const result = await runHttpsCallableFunction('copyProjectMoveChatSecondGen', {
        sourceProjectId: oldProjectId,
        targetProjectId: newProjectId,
        objectType,
        objectId: chatId,
    })
    if (!result?.copied) return

    if (beforeDeleteSource && chatData) await beforeDeleteSource({ ...chatData, id: chatId })
}

export async function updateStickyChatData(projectId, chatId, stickyData) {
    await updateChatData(projectId, chatId, { stickyData }, null)
    const { stickyEndDate, days } = stickyData
    stickyEndDate > 0 ? trackStickyNote(projectId, chatId, stickyEndDate) : untrackStickyNote(chatId)
}

export async function getChatMeta(projectId, chatId) {
    const path = `chatObjects/${projectId}/chats/${chatId}`
    const chatData = (await getDb().doc(path).get()).data()
    return chatData ? { id: chatId, ...chatData } : null
}

export function removeChatTopic(projectId, chatId) {
    getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).delete()
}
