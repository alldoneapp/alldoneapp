import moment from 'moment'
import { firebase } from '@firebase/app'
import { difference, uniq } from 'lodash'

import TasksHelper, {
    GENERIC_COMMENT_TYPE,
    MAX_GOLD_TO_EARN_BY_COMMENT,
} from '../../../components/TaskListView/Utils/TasksHelper'
import { updateAssistantLastCommentData, resetAssistantLastCommentData } from '../Assistants/assistantsFirestore'
import {
    getGoalData,
    setGoalAssistant,
    updateGoalLastCommentData,
    resetGoalLastCommentData,
} from '../Goals/goalsFirestore'
import {
    getSkillData,
    setSkillAssistant,
    updateSkillLastCommentData,
    resetSkillLastCommentData,
} from '../Skills/skillsFirestore'
import {
    addFollowerWithoutFeeds,
    earnGold,
    getDb,
    getFirestoreTime,
    getId,
    getMentionedUsersIdsWhenEditText,
    getNote,
    getTaskData,
    globalWatcherUnsub,
    logEvent,
    runHttpsCallableFunction,
    tryAddFollower,
} from '../firestore'
import { FEED_PUBLIC_FOR_ALL, FOLLOWED_TAB } from '../../../components/Feeds/Utils/FeedsConstants'
import { setNoteAssistant, updateNoteLastCommentData, resetNoteLastCommentData } from '../Notes/notesFirestore'
import {
    createGenericTaskWhenMention,
    setTaskAssistant,
    updateTaskLastCommentData,
    resetTaskLastCommentData,
} from '../Tasks/tasksFirestore'
import store from '../../../redux/store'
import {
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN,
    cleanTextMetaData,
    removeFormatTagsFromText,
    shrinkTagText,
} from '../../../functions/Utils/parseTextUtils'
import {
    getAssistantInProject,
    getAssistantInProjectObject,
} from '../../../components/AdminPanel/Assistants/assistantsHelper'
import { setUserAssistant, updateUserLastCommentData, resetUserLastCommentData } from '../Users/usersFirestore'
import {
    setContactAssistant,
    updateContactLastCommentData,
    resetContactLastCommentData,
} from '../Contacts/contactsFirestore'
import { getLinkedParentChatUrl } from '../../../components/ChatsView/Utils/ChatHelper'
import { PROJECT_TYPE_GUIDE } from '../../../components/SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { setProjectLastChatActionDate } from '../Projects/projectsFirestore'
import { getChatMeta, updateChatData } from './chatsFirestore'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import {
    FOLLOWER_ASSISTANTS_TYPE,
    FOLLOWER_CONTACTS_TYPE,
    FOLLOWER_GOALS_TYPE,
    FOLLOWER_NOTES_TYPE,
    FOLLOWER_SKILLS_TYPE,
    FOLLOWER_TASKS_TYPE,
    FOLLOWER_TOPICS_TYPE,
    FOLLOWER_USERS_TYPE,
} from '../../../components/Followers/FollowerConstants'
import { generateUserIdsToNotifyForNewComments } from '../../assistantHelper'

export const ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY = 'allProjects'

export const getProjectChatLastNotification = (projectId, projectNotifications, projectChatLastNotification) => {
    const lastNotifications = {
        ...projectChatLastNotification,
        [projectId]: null,
    }

    projectNotifications.forEach(notification => {
        const { followed, date } = notification
        if (followed) {
            if (!lastNotifications[projectId] || lastNotifications[projectId].date < date) {
                lastNotifications[projectId] = notification
            }
        }
    })

    lastNotifications[ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY] = getAllProjectsChatLastNotification(lastNotifications)
    return lastNotifications
}

const getAllProjectsChatLastNotification = notifications => {
    const keys = Object.keys(notifications)
    let allProjectsNotification = null
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i]
        if (key !== ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY && notifications[key]) {
            if (!allProjectsNotification || allProjectsNotification.date < notifications[key].date) {
                allProjectsNotification = {
                    ...notifications[key],
                    projectId: key,
                }
            }
        }
    }
    return allProjectsNotification
}

export const watchComments = (projectId, chatType, chatId, watcherKey, amountCommentsToGet, callback) => {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`chatComments/${projectId}/${chatType}/${chatId}/comments`)
        .orderBy('created', 'desc')
        .limit(amountCommentsToGet)
        .onSnapshot(snapshot => {
            const comments = []
            snapshot.forEach(doc => {
                comments.push({ ...doc.data(), id: doc.id })
            })
            callback(comments)
        })
}

export function watchChatNotifications(projectId, userId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`chatNotifications/${projectId}/${userId}`)
        .onSnapshot(snapshot => {
            const notifications = []
            snapshot.forEach(doc => {
                notifications.push(doc.data())
            })
            callback(notifications)
        })
}

const getParentObjectData = async (projectId, objectId, objectType) => {
    let isPublicFor = null
    let assistantId = ''
    let followObjectsType = null
    let object = null
    let parentObjectCreatorId = ''
    let title = ''

    switch (objectType) {
        case 'tasks':
            await getTaskData(projectId, objectId).then(task => {
                object = task
                isPublicFor = task.isPublicFor
                assistantId = task.assistantId
                parentObjectCreatorId = task.creatorId
                title = task.extendedName
                followObjectsType = FOLLOWER_TASKS_TYPE
            })
            break
        case 'notes':
            await getNote(projectId, objectId).then(note => {
                object = note
                isPublicFor = note.isPublicFor
                assistantId = note.assistantId
                parentObjectCreatorId = note.creatorId
                title = note.extendedTitle
                followObjectsType = FOLLOWER_NOTES_TYPE
            })
            break
        case 'topics':
            await getChatMeta(projectId, objectId).then(chat => {
                object = chat
                isPublicFor = chat.isPublicFor
                assistantId = chat.assistantId
                parentObjectCreatorId = chat.creatorId
                title = chat.title
                followObjectsType = FOLLOWER_TOPICS_TYPE
            })
            break
        case 'contacts':
            const user = TasksHelper.getUserInProject(projectId, objectId)
            const objectIsUser = !!user
            const contact = user || TasksHelper.getContactInProject(projectId, objectId)
            object = contact
            isPublicFor = contact.isPublicFor
            assistantId = contact.assistantId
            parentObjectCreatorId = objectIsUser ? objectId : contact.recorderUserId
            title = contact.displayName
            followObjectsType = objectIsUser ? FOLLOWER_USERS_TYPE : FOLLOWER_CONTACTS_TYPE
            break
        case 'goals':
            await getGoalData(projectId, objectId).then(goal => {
                object = goal
                isPublicFor = goal.isPublicFor
                assistantId = goal.assistantId
                parentObjectCreatorId = goal.creatorId
                title = goal.extendedName
                followObjectsType = FOLLOWER_GOALS_TYPE
            })
            break
        case 'skills':
            await getSkillData(projectId, objectId).then(skill => {
                object = skill
                isPublicFor = skill.isPublicFor
                assistantId = skill.assistantId
                parentObjectCreatorId = skill.userId
                title = skill.extendedName
                followObjectsType = FOLLOWER_SKILLS_TYPE
            })
            break
        case 'assistants':
            const assistant = getAssistantInProject(projectId, objectId)
            object = assistant
            isPublicFor = [FEED_PUBLIC_FOR_ALL]
            assistantId = objectId
            parentObjectCreatorId = assistant.creatorId
            title = assistant.displayName
            followObjectsType = FOLLOWER_ASSISTANTS_TYPE
            break
    }

    return { isPublicFor, assistantId, followObjectsType, object, parentObjectCreatorId, title }
}

export const getParentObjectName = async (projectId, objectId, objectType) => {
    let name = ''

    switch (objectType) {
        case 'tasks':
            const task = await getTaskData(projectId, objectId)
            if (task) name = task.extendedName
            break
        case 'notes':
            const note = await getNote(projectId, objectId)
            if (note) name = note.extendedTitle
            break
        case 'topics':
            const chat = await getChatMeta(projectId, objectId)
            if (chat) name = chat.title
            break
        case 'contacts':
            const user = TasksHelper.getUserInProject(projectId, objectId)
            const contact = user || TasksHelper.getContactInProject(projectId, objectId)
            if (contact) name = contact.displayName
            break
        case 'goals':
            const goal = await getGoalData(projectId, objectId)
            if (goal) name = goal.extendedName
            break
        case 'skills':
            const skill = await getSkillData(projectId, objectId)
            if (skill) name = skill.extendedName
            break
        case 'assistants':
            const assistant = getAssistantInProject(projectId, objectId)
            if (assistant) name = assistant.displayName
            break
    }

    return name
}

const updateParentObjectAssistantIfNeeded = (projectId, assistantId, objectId, objectType) => {
    if (!assistantId || !getAssistantInProjectObject(projectId, assistantId)) {
        const { defaultAssistant } = store.getState()
        const needGenerateUpdate = !!assistantId

        const project = ProjectHelper.getProjectById(projectId)
        const newAssistantId = project.assistantId || defaultAssistant.uid

        switch (objectType) {
            case 'tasks':
                setTaskAssistant(projectId, objectId, newAssistantId, needGenerateUpdate)
                break
            case 'notes':
                setNoteAssistant(projectId, objectId, newAssistantId, needGenerateUpdate)
                break
            case 'contacts':
                const isUser = !!TasksHelper.getUserInProject(projectId, objectId)
                isUser
                    ? setUserAssistant(projectId, objectId, newAssistantId, needGenerateUpdate)
                    : setContactAssistant(projectId, objectId, newAssistantId, needGenerateUpdate)
                break
            case 'goals':
                setGoalAssistant(projectId, objectId, newAssistantId, needGenerateUpdate)
                break
            case 'skills':
                setSkillAssistant(projectId, objectId, newAssistantId, needGenerateUpdate)
                break
        }

        return newAssistantId
    }
    return assistantId
}

const updateLastAssistantCommentData = async (projectId, objectId, objectType, creatorId, followerIds, batch) => {
    followerIds.forEach(followerId => {
        const updateData = { objectType, objectId, creatorId, creatorType: 'user', date: moment().utc().valueOf() }
        batch.update(getDb().doc(`users/${followerId}`), {
            [`lastAssistantCommentData.${projectId}`]: updateData,
            [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: {
                ...updateData,
                projectId,
            },
        })
    })
}

const storeComment = async (
    projectId,
    objectId,
    objectType,
    commentId,
    comment,
    commentType,
    editingCommentId,
    userIdsToNotify,
    creatorId,
    followerIds,
    title,
    chatMembers
) => {
    const batch = new BatchWrapper(getDb())
    if (!editingCommentId) {
        const followrsMap = {}
        followerIds.forEach(uid => {
            followrsMap[uid] = true
        })
        userIdsToNotify.forEach(userId => {
            batch.set(getDb().doc(`chatNotifications/${projectId}/${userId}/${commentId}`), {
                chatId: objectId,
                chatType: objectType,
                followed: !!followrsMap[userId],
                date: moment().utc().valueOf(),
                creatorId,
                creatorType: 'user',
            })
        })

        generatePushAndEmailNotifcations(
            projectId,
            objectType,
            objectId,
            comment,
            followerIds.filter(uid => uid !== creatorId),
            title,
            commentId,
            batch
        )

        updateLastAssistantCommentData(projectId, objectId, objectType, creatorId, followerIds, batch)
    }
    batch.set(
        getDb().doc(`chatComments/${projectId}/${objectType}/${objectId}/comments/${commentId}`),
        editingCommentId
            ? { commentText: comment }
            : {
                  commentText: comment,
                  lastChangeDate: getFirestoreTime(),
                  created: moment().valueOf(),
                  creatorId,
                  fromAssistant: false,
                  ...(objectType === 'tasks' && { commentType }),
              },
        { merge: true }
    )

    await batch.commit()
}

const generatePushAndEmailNotifcations = (
    projectId,
    objectType,
    objectId,
    comment,
    followerIds,
    title,
    commentId,
    batch
) => {
    if (followerIds.length > 0) {
        const messageTimestamp = Date.now()
        sendChatPushNotification(
            projectId,
            objectType,
            objectId,
            comment,
            followerIds,
            title,
            commentId,
            messageTimestamp,
            batch
        )
        batch.set(
            getDb().doc(`emailNotifications/${objectId}`),
            {
                userIds: firebase.firestore.FieldValue.arrayUnion(...followerIds),
                projectId,
                objectType: objectType === 'topics' ? 'chats' : objectType,
                objectId,
                objectName: TasksHelper.getTaskNameWithoutMeta(title),
                messageTimestamp,
            },
            { merge: true }
        )
    }
}

const earnGoldInCommunitesWhenComment = (projectId, editingCommentId, isPublicFor, creatorId) => {
    const { loggedUser } = store.getState()
    if (
        !editingCommentId &&
        isPublicFor.includes(FEED_PUBLIC_FOR_ALL) &&
        ProjectHelper.getTypeOfProject(loggedUser, projectId) === PROJECT_TYPE_GUIDE
    ) {
        earnGold(projectId, creatorId, MAX_GOLD_TO_EARN_BY_COMMENT, 'buttonContainerId')
    }
}

const getFollowerLists = async (projectId, objectType, objectId, creatorId, oldComment, comment, isPublicFor) => {
    let parentFollowerIds = await getParentObjectFollowerIds(projectId, objectType, objectId)
    parentFollowerIds = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        ? parentFollowerIds
        : parentFollowerIds.filter(uid => isPublicFor.includes(uid))

    let newFollowerIds = [creatorId]

    const mentionedUserIdsInOldComment = oldComment ? TasksHelper.getMentionIdsFromTitle(oldComment) : []
    const mentionedUserIdsInNewComment = TasksHelper.getMentionIdsFromTitle(comment)
    const newMentionedUserIdsInComment = difference(mentionedUserIdsInNewComment, mentionedUserIdsInOldComment)

    newFollowerIds.push(...newMentionedUserIdsInComment)

    newFollowerIds = uniq(newFollowerIds)

    newFollowerIds = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        ? newFollowerIds
        : newFollowerIds.filter(uid => isPublicFor.includes(uid))

    newFollowerIds = difference(newFollowerIds, parentFollowerIds)

    const followerIds = [...parentFollowerIds, ...newFollowerIds]

    return { followerIds, newFollowerIds, newMentionIds: newMentionedUserIdsInComment }
}

export async function createObjectMessage(
    projectId,
    objectId,
    comment,
    objectType,
    commentType,
    editingCommentId,
    oldComment,
    skipAssistantTrigger = false
) {
    const promises = []
    promises.push(getParentObjectData(projectId, objectId, objectType))
    promises.push(getChatMeta(projectId, objectId))
    const [parentData, chat] = await Promise.all(promises)
    let { isPublicFor, assistantId, followObjectsType, object, parentObjectCreatorId, title } = parentData

    if (object) {
        const { loggedUser, assistantEnabled } = store.getState()
        const { uid: creatorId } = loggedUser

        const chatIsAlreadyCreated = !!chat
        const commentId = editingCommentId || getId()

        updateLastCommentData(projectId, editingCommentId, objectId, objectType, comment, commentType)

        // Debug logging for webhook task detection
        console.log('🔍 WEBHOOK DEBUG: Checking if webhook task:', {
            objectType,
            objectId,
            hasObject: !!object,
            hasTaskMetadata: !!object?.taskMetadata,
            isWebhookTask: object?.taskMetadata?.isWebhookTask,
            taskMetadata: object?.taskMetadata,
            editingCommentId,
        })

        // Check if this is a webhook task and trigger webhook with the user's message
        if (!editingCommentId && objectType === 'tasks' && object?.taskMetadata?.isWebhookTask) {
            console.log('🌐 WEBHOOK MESSAGE: Detected message in webhook task, triggering webhook:', {
                taskId: objectId,
                webhookUrl: object.taskMetadata.webhookUrl,
                messageLength: comment.length,
            })
            // Trigger webhook execution asynchronously
            runHttpsCallableFunction('executeWebhookForMessage', {
                userId: creatorId,
                projectId,
                objectId,
                prompt: comment,
                taskMetadata: object.taskMetadata,
                userIdsToNotify: generateUserIdsToNotifyForNewComments(projectId, isPublicFor, creatorId),
                isPublicFor,
                assistantId,
            })
                .then(result => {
                    console.log('🌐 WEBHOOK MESSAGE: Webhook triggered successfully:', result)
                })
                .catch(error => {
                    console.error('🌐 WEBHOOK MESSAGE: Error triggering webhook:', error)
                    alert(`Webhook failed: ${error.message}`)
                })
        }

        const userIdsToNotify = generateUserIdsToNotifyForNewComments(projectId, isPublicFor, creatorId)

        const { followerIds, newFollowerIds, newMentionIds } = await getFollowerLists(
            projectId,
            objectType,
            objectId,
            creatorId,
            oldComment,
            comment,
            isPublicFor
        )

        assistantId = updateParentObjectAssistantIfNeeded(projectId, assistantId, objectId, objectType)

        const promises = []
        promises.push(
            storeComment(
                projectId,
                objectId,
                objectType,
                commentId,
                comment,
                commentType,
                editingCommentId,
                userIdsToNotify,
                creatorId,
                followerIds,
                title,
                chat ? uniq([...chat.members, creatorId]) : [creatorId]
            )
        )

        if (chatIsAlreadyCreated) {
            updateChatWhenAddComment(projectId, creatorId, comment, commentType, objectId)
        } else {
            promises.push(
                createChat(
                    objectId,
                    projectId,
                    creatorId,
                    comment,
                    objectType,
                    title,
                    isPublicFor,
                    '#ffffff',
                    null,
                    followerIds,
                    '',
                    assistantId,
                    commentType,
                    parentObjectCreatorId
                )
            )
        }

        newFollowerIds.forEach(uid => {
            const user = TasksHelper.getUserInProject(projectId, uid)
            if (user) {
                const followData = {
                    followObjectsType,
                    followObjectId: objectId,
                    feedCreator: user,
                    followObject: object,
                }
                tryAddFollower(projectId, followData, null)
            }
        })

        if (!editingCommentId) {
            earnGoldInCommunitesWhenComment(projectId, editingCommentId, isPublicFor, creatorId)
            logEvent('new_chat_message', {
                id: commentId,
                objectId: objectId,
                objectType: objectType,
            })
        }

        createGenericTaskWhenMention(projectId, objectId, newMentionIds, GENERIC_COMMENT_TYPE, objectType, assistantId)

        // Check if this is a webhook task - if so, don't trigger regular AI assistant
        const isWebhookTask = objectType === 'tasks' && object?.taskMetadata?.isWebhookTask

        await Promise.all(promises).then(() => {
            // Only trigger regular AI assistant if not a webhook task and not explicitly skipped
            console.log('🔍 [TIMING] CLIENT: Checking assistant trigger conditions', {
                editingCommentId,
                assistantEnabled,
                isWebhookTask,
                skipAssistantTrigger,
                objectType,
                hasTaskMetadata: !!object?.taskMetadata,
            })
            if (!editingCommentId && assistantEnabled && !isWebhookTask && !skipAssistantTrigger) {
                const clientSubmissionTime = Date.now()
                const clientSubmissionTimestamp = new Date().toISOString()
                console.log('⏱️ [TIMING] CLIENT: User message submitted, calling askToBotSecondGen', {
                    timestamp: clientSubmissionTimestamp,
                    submissionTime: clientSubmissionTime,
                    submissionTimeISO: clientSubmissionTimestamp,
                    userId: creatorId,
                    messageId: commentId,
                    projectId,
                    objectType,
                    objectId,
                    assistantId,
                })
                const functionCallStartTime = Date.now()
                runHttpsCallableFunction(
                    'askToBotSecondGen',
                    {
                        userId: creatorId,
                        messageId: commentId,
                        projectId,
                        objectType,
                        objectId,
                        userIdsToNotify: [...userIdsToNotify, creatorId],
                        isPublicFor,
                        language: window.navigator.language,
                        assistantId,
                        followerIds,
                    },
                    {
                        timeout: 540000, // 9 minutes to match backend timeout
                    }
                )
                    .then(result => {
                        const clientCallCompleteTime = Date.now()
                        const totalClientToServerTime = clientCallCompleteTime - clientSubmissionTime
                        const networkLatency = functionCallStartTime - clientSubmissionTime
                        console.log('⏱️ [TIMING] CLIENT: askToBotSecondGen call initiated successfully', {
                            timestamp: new Date().toISOString(),
                            submissionTime: clientSubmissionTime,
                            submissionTimeISO: clientSubmissionTimestamp,
                            completionTime: clientCallCompleteTime,
                            completionTimeISO: new Date().toISOString(),
                            timeSinceSubmission: `${totalClientToServerTime}ms`,
                            networkLatency: `${networkLatency}ms`,
                            backendProcessingTime: `${totalClientToServerTime - networkLatency}ms`,
                            result,
                        })
                    })
                    .catch(error => {
                        console.error('⏱️ [TIMING] CLIENT: Error calling askToBotSecondGen', {
                            error: error.message,
                            timestamp: new Date().toISOString(),
                            submissionTime: clientSubmissionTime,
                            submissionTimeISO: clientSubmissionTimestamp,
                            timeSinceSubmission: `${Date.now() - clientSubmissionTime}ms`,
                        })
                    })
            }
        })
    }
}

export const createChat = async (
    chatId,
    projectId,
    creatorId,
    comment,
    type,
    title,
    isPublicFor,
    hasStar,
    stickyData,
    followerIds,
    quickDateId,
    assistantId,
    commentType,
    parentObjectCreatorId
) => {
    // Get the usersFollowing list before creating the chat
    const usersFollowing = followerIds || (await getChatFollowerIds(projectId, title, type, chatId))

    const chat = {
        id: chatId,
        title,
        type,
        members: firebase.firestore.FieldValue.arrayUnion(creatorId),
        lastEditionDate: Date.now(),
        lastEditorId: creatorId,
        commentsData: comment
            ? {
                  lastCommentOwnerId: creatorId,
                  lastComment: cleanTextMetaData(removeFormatTagsFromText(comment), true).trim() || 'Comment',
                  lastCommentType: commentType,
                  amount: firebase.firestore.FieldValue.increment(1),
              }
            : null,
        hasStar,
        creatorId: parentObjectCreatorId,
        isPublicFor,
        created: moment().valueOf(),
        usersFollowing,
        quickDateId: quickDateId ? quickDateId : '',
        assistantId,
        ...(stickyData ? { stickyData } : { stickyData: { days: 0, stickyEndDate: 0 } }),
    }

    const promises = []
    promises.push(getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).set(chat))
    promises.push(setProjectLastChatActionDate(projectId))
    promises.push(logEvent('new_chat', { id: chatId }))
    promises.push(addFollowersToChat(projectId, title, type, chatId, usersFollowing))
    await Promise.all(promises)

    return chat
}

const updateChatWhenAddComment = async (projectId, creatorId, cleanedComment, commentType, chatId) => {
    const updateData = {
        members: firebase.firestore.FieldValue.arrayUnion(creatorId),
        commentsData: null,
    }

    updateData.commentsData = {
        lastCommentOwnerId: creatorId,
        lastComment: cleanTextMetaData(removeFormatTagsFromText(cleanedComment), true).trim() || 'Comment',
        lastCommentType: commentType,
        amount: firebase.firestore.FieldValue.increment(1),
    }

    updateChatData(projectId, chatId, updateData, null)
    setProjectLastChatActionDate(projectId)
}

const getLastComment = async (projectId, objectType, objectId) => {
    const docs = (
        await getDb()
            .collection(`chatComments/${projectId}/${objectType}/${objectId}/comments`)
            .orderBy('lastChangeDate', 'desc')
            .limit(1)
            .get()
    ).docs
    return docs.length > 0 ? { ...docs[0].data(), id: docs[0].id } : null
}

const updateLastCommentData = async (projectId, editingCommentId, objectId, objectType, comment, commentType) => {
    if (editingCommentId) {
        getLastComment(projectId, objectType, objectId).then(lastComment => {
            if (lastComment && lastComment.id === editingCommentId) {
                updateLastCommentDataOfChatParentObject(projectId, objectId, objectType, comment, commentType)
            }
        })
    } else {
        updateLastCommentDataOfChatParentObject(projectId, objectId, objectType, comment, commentType)
    }
}

const updateLastCommentDataOfChatParentObject = async (projectId, objectId, type, lastComment, commentType) => {
    const parsedComment = cleanTextMetaData(removeFormatTagsFromText(lastComment), true).trim()
    const cleanedComment = shrinkTagText(parsedComment || 'Comment', LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN)

    if (type === 'assistants') {
        await updateAssistantLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'contacts') {
        if (TasksHelper.getUserInProject(projectId, objectId)) {
            updateUserLastCommentData(projectId, objectId, cleanedComment, commentType)
        } else if (TasksHelper.getContactInProject(projectId, objectId)) {
            updateContactLastCommentData(projectId, objectId, cleanedComment, commentType)
        }
    } else if (type === 'skills') {
        await updateSkillLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'tasks') {
        await updateTaskLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'goals') {
        await updateGoalLastCommentData(projectId, objectId, cleanedComment, commentType)
    } else if (type === 'notes') {
        await updateNoteLastCommentData(projectId, objectId, cleanedComment, commentType)
    }
}

export const repairChatMetadata = async (projectId, objectId, type) => {
    if (type === 'assistants') {
        await resetAssistantLastCommentData(projectId, objectId)
    } else if (type === 'contacts') {
        if (TasksHelper.getUserInProject(projectId, objectId)) {
            resetUserLastCommentData(projectId, objectId)
        } else if (TasksHelper.getContactInProject(projectId, objectId)) {
            resetContactLastCommentData(projectId, objectId)
        }
    } else if (type === 'skills') {
        await resetSkillLastCommentData(projectId, objectId)
    } else if (type === 'tasks') {
        await resetTaskLastCommentData(projectId, objectId)
    } else if (type === 'goals') {
        await resetGoalLastCommentData(projectId, objectId)
    } else if (type === 'notes') {
        await resetNoteLastCommentData(projectId, objectId)
    }
}

const sendChatPushNotification = async (
    projectId,
    objectType,
    objectId,
    message,
    followerIds,
    objectName,
    commentId,
    messageTimestamp,
    batch
) => {
    const { displayName: userName } = store.getState().loggedUser

    const project = ProjectHelper.getProjectById(projectId)
    const cleanedComment = TasksHelper.getTaskNameWithoutMeta(message)
    batch.set(getDb().doc(`pushNotifications/${commentId}`), {
        userIds: followerIds,
        body: `${project.name}\n  ✔ ${objectName}\n ${userName} ${'commented'}: ${cleanedComment}`,
        link: getLinkedParentChatUrl(projectId, objectType, objectId),
        messageTimestamp,
        type: 'Chat Notification',
        chatId: objectId,
        projectId,
    })
}

const addFollowersToChat = async (projectId, chatName, objectType, chatId, followerIds) => {
    const usersFollowing = followerIds || (await getChatFollowerIds(projectId, chatName, objectType, chatId))

    const batch = new BatchWrapper(getDb())
    console.log('addFollowersToChat parameters:', {
        projectId,
        chatName,
        objectType,
        chatId,
        followerIds,
        usersFollowing,
    })
    // maybe we wanted to not have feeds because it's a chat and then we dont want updates
    if (objectType === 'topics') {
        usersFollowing.forEach(userId => {
            addFollowerWithoutFeeds(projectId, userId, objectType, chatId, null, batch)
        })
    }
    batch.update(getDb().doc(`chatObjects/${projectId}/chats/${chatId}`), { usersFollowing })
    await batch.commit()
}

const getParentObjectFollowerIds = async (projectId, objectType, chatId) => {
    const doc = await getDb().doc(`followers/${projectId}/${objectType}/${chatId}`).get()
    const data = doc.data()
    const followersFromCollection = data ? data.usersFollowing : []

    // If no followers in the collection yet, try reading from the chat object itself
    if (followersFromCollection.length === 0 && objectType === 'topics') {
        const chatDoc = await getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).get()
        const chat = chatDoc.data()
        if (chat && chat.usersFollowing && chat.usersFollowing.length > 0) {
            return chat.usersFollowing
        }
    }

    return followersFromCollection
}

const getChatFollowerIds = async (projectId, chatName, objectType, chatId) => {
    if (objectType === 'topics') {
        const mentionedUserIds = getMentionedUsersIdsWhenEditText(chatName, '')
        const userId = store.getState().loggedUser.uid
        return uniq([userId, ...mentionedUserIds])
    } else {
        return await getParentObjectFollowerIds(projectId, objectType, chatId)
    }
}

async function setFollowChatNotifications(projectId, userId, chatId, followed, batch) {
    const docs = await getDb()
        .collection(`chatNotifications/${projectId}/${userId}`)
        .where('chatId', '==', chatId)
        .get()
    docs.forEach(doc => {
        batch.update(getDb().doc(`chatNotifications/${projectId}/${userId}/${doc.id}`), { followed })
    })
}

export async function addFollowerToChat(projectId, chatId, userId) {
    const db = getDb()
    const doc = await db.doc(`chatObjects/${projectId}/chats/${chatId}`).get()
    if (doc.exists) {
        const chat = doc.data()
        const { usersFollowing } = chat
        if (!usersFollowing.includes(userId)) {
            const batch = new BatchWrapper(db)
            batch.update(db.doc(`chatObjects/${projectId}/chats/${chatId}`), {
                usersFollowing: firebase.firestore.FieldValue.arrayUnion(userId),
            })
            await setFollowChatNotifications(projectId, userId, chatId, true, batch)
            await batch.commit()
        }
    }
}

export async function removeFollowerFromChat(projectId, chatId, userId) {
    const db = getDb()
    const doc = await db.doc(`chatObjects/${projectId}/chats/${chatId}`).get()
    if (doc.exists) {
        const chat = doc.data()
        const { usersFollowing } = chat
        if (usersFollowing.includes(userId)) {
            const batch = new BatchWrapper(db)
            batch.update(db.doc(`chatObjects/${projectId}/chats/${chatId}`), {
                usersFollowing: firebase.firestore.FieldValue.arrayRemove(userId),
            })
            await setFollowChatNotifications(projectId, userId, chatId, false, batch)
            await batch.commit()
        }
    }
}

export const getFollowedAndUnfollowedChatNotificationsAmount = (
    inAllProjects,
    selectedProjectId,
    projectChatNotifications,
    archivedProjectIds,
    templateProjectIds
) => {
    if (inAllProjects) {
        let globalTotalFollowed = 0
        let globalTotalUnfollowed = 0
        const projectIds = Object.keys(projectChatNotifications)
        projectIds.forEach(projectId => {
            const needToCount = !archivedProjectIds.includes(projectId) && !templateProjectIds.includes(projectId)
            if (needToCount) {
                const { totalFollowed, totalUnfollowed } = projectChatNotifications[projectId]
                globalTotalFollowed += totalFollowed
                globalTotalUnfollowed += totalUnfollowed
            }
        })
        return { totalFollowed: globalTotalFollowed, totalUnfollowed: globalTotalUnfollowed }
    } else {
        return projectChatNotifications[selectedProjectId] || { totalFollowed: 0, totalUnfollowed: 0 }
    }
}

export const getNewFollowedAndUnfollowedCommentsAmountInProjectList = (projectChatNotifications, projectIdsList) => {
    let globalTotalFollowed = 0
    let globalTotalUnfollowed = 0
    const projectIds = Object.keys(projectChatNotifications)
    projectIds.forEach(projectId => {
        const needToCount = projectIdsList.includes(projectId)
        if (needToCount) {
            const { totalFollowed, totalUnfollowed } = projectChatNotifications[projectId]
            globalTotalFollowed += totalFollowed
            globalTotalUnfollowed += totalUnfollowed
        }
    })
    return { totalFollowed: globalTotalFollowed, totalUnfollowed: globalTotalUnfollowed }
}

export const resetNotificationsWhenUserHasAnActiveChat = (projectChatNotifications, activeChatData) => {
    const { projectId, chatId, chatType } = activeChatData

    if (
        projectId &&
        chatId &&
        chatType &&
        projectChatNotifications[projectId] &&
        projectChatNotifications[projectId][chatId]
    ) {
        const { totalFollowed, totalUnfollowed } = projectChatNotifications[projectId][chatId]
        if (totalFollowed || totalUnfollowed) {
            projectChatNotifications = { ...projectChatNotifications }
            projectChatNotifications[projectId] = { ...projectChatNotifications[projectId] }
            projectChatNotifications[projectId].totalFollowed -=
                projectChatNotifications[projectId][chatId].totalFollowed
            projectChatNotifications[projectId].totalUnfollowed -=
                projectChatNotifications[projectId][chatId].totalUnfollowed

            delete projectChatNotifications[projectId][chatId]
        }
    }
    return projectChatNotifications
}

export async function markMessagesAsRead(projectId, userId, chatsActiveTab) {
    const { loggedUser } = store.getState()

    let newCommentsRef = getDb().collection(`chatNotifications/${projectId}/${userId}`)
    if (chatsActiveTab === FOLLOWED_TAB) newCommentsRef = newCommentsRef.where('followed', '==', true)

    newCommentsRef.get().then(snapshot => {
        removeAllChatNotifications(projectId, userId, snapshot.docs)
    })

    getDb()
        .collection(`pushNotifications`)
        .where('projectId', '==', projectId)
        .where('userIds', 'array-contains', loggedUser.uid)
        .get()
        .then(snapshot => {
            removeAllChatPushNotifications(snapshot)
        })
    getDb()
        .collection(`emailNotifications`)
        .where('projectId', '==', projectId)
        .where('userIds', 'array-contains', loggedUser.uid)
        .get()
        .then(snapshot => {
            removeAllChatEmailNotifications(snapshot)
        })
}

export async function markChatMessagesAsRead(projectId, chatId) {
    const { loggedUser } = store.getState()

    getDb()
        .collection(`chatNotifications/${projectId}/${loggedUser.uid}`)
        .where('chatId', '==', chatId)
        .get()
        .then(snapshot => {
            removeAllChatNotifications(projectId, loggedUser.uid, snapshot.docs)
        })

    getDb()
        .doc(`emailNotifications/${chatId}`)
        .get()
        .then(doc => {
            const notification = doc.data()
            if (notification && notification.userIds.includes(loggedUser.uid)) {
                notification.userIds.length > 1
                    ? getDb()
                          .doc(`emailNotifications/${chatId}`)
                          .set(
                              { ...notification, userIds: firebase.firestore.FieldValue.arrayRemove(loggedUser.uid) },
                              { merge: true }
                          )
                    : getDb().doc(`emailNotifications/${chatId}`).delete()
            }
        })

    getDb()
        .collection(`pushNotifications`)
        .where('chatId', '==', chatId)
        .where('userIds', 'array-contains', loggedUser.uid)
        .get()
        .then(snapshot => {
            removeAllChatPushNotifications(snapshot)
        })
}

async function removeAllChatNotifications(projectId, userId, docs) {
    const batch = new BatchWrapper(getDb())
    docs.forEach(doc => {
        batch.delete(getDb().doc(`chatNotifications/${projectId}/${userId}/${doc.id}`))
    })
    batch.commit()
}

async function removeAllChatPushNotifications(docs) {
    const { loggedUser } = store.getState()
    const batch = new BatchWrapper(getDb())
    docs.forEach(doc => {
        const notification = doc.data()
        notification.userIds.length > 1
            ? batch.set(
                  getDb().doc(`pushNotifications/${doc.id}`),
                  {
                      ...notification,
                      userIds: firebase.firestore.FieldValue.arrayRemove(loggedUser.uid),
                  },
                  { merge: true }
              )
            : batch.delete(getDb().doc(`pushNotifications/${doc.id}`))
    })
    batch.commit()
}

async function removeAllChatEmailNotifications(docs) {
    const { loggedUser } = store.getState()
    const batch = new BatchWrapper(getDb())
    docs.forEach(doc => {
        const notification = doc.data()
        notification.userIds.length > 1
            ? batch.set(
                  getDb().doc(`emailNotifications/${doc.id}`),
                  {
                      ...notification,
                      userIds: firebase.firestore.FieldValue.arrayRemove(loggedUser.uid),
                  },
                  { merge: true }
              )
            : batch.delete(getDb().doc(`emailNotifications/${doc.id}`))
    })
    batch.commit()
}
