import { cloneDeep, intersection, isEqual, uniq } from 'lodash'
import { firebase } from '@firebase/app'
import moment from 'moment'

import {
    addUniqueInstanceTypeToArray,
    creatTaskFeedChain,
    createFollowUpBacklinksToNotes,
    createGenericTaskWhenMentionInTitleEdition,
    createMentionTasksAfterSetTaskPublic,
    createSubtasksCopies,
    deleteSubTaskFromParent,
    earnGold,
    feedsChainInStopObservingTask,
    generateNegativeSortIndex,
    generateNegativeSortTaskIndex,
    generateSortIndex,
    getDb,
    getId,
    getMentionedUsersIdsWhenEditText,
    getNoteMeta,
    getObjectFollowersIds,
    getTaskData,
    globalWatcherUnsub,
    insertFollowersUserToFeedChain,
    logDoneTasks,
    logEvent,
    mapTaskData,
    moveTasksinWorkflowFeedsChain,
    moveToTomorrowGoalReminderDateIfThereAreNotMoreTasks,
    processFollowersWhenEditTexts,
    registerTaskObservedFeeds,
    setTaskDueDateFeedsChain,
    setTaskParentGoalFeedsChain,
    setTaskProjectFeedsChain,
    setTaskToBacklogFeedsChain,
    tryAddFollower,
    updateStatistics,
    updateTaskFeedsChain,
    uploadNewSubTaskFeedsChain,
} from '../firestore'
import store from '../../../redux/store'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import {
    createSubtaskPromotedFeed,
    createTaskAssigneeChangedFeed,
    createTaskAssigneeEstimationChangedFeed,
    createTaskAssistantChanged,
    createTaskCheckedDoneFeed,
    createTaskDescriptionChangedFeed,
    createTaskFocusChangedFeed,
    createTaskHighlightedChangedFeed,
    createTaskNameChangedFeed,
    createTaskObserverEstimationChangedFeed,
    createTaskPrivacyChangedFeed,
    createTaskRecurrenceChangedFeed,
    createTaskReviewerEstimationChangedFeed,
    createTaskUncheckedDoneFeed,
} from './taskUpdates'
import { creatFollowUpTaskFeedChain } from './taskUpdatesChains'

import { FOLLOWER_TASKS_TYPE } from '../../../components/Followers/FollowerConstants'
import {
    setLastTaskAddedId,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTasks,
    setSelectedTypeOfProject,
    startLoadingData,
    stopLoadingData,
    switchProject,
} from '../../../redux/actions'
import {
    WORKSTREAM_ID_PREFIX,
    getWorkstreamInProject,
    isWorkstream,
} from '../../../components/Workstreams/WorkstreamHelper'
import TasksHelper, {
    BACKLOG_DATE_NUMERIC,
    DONE_STEP,
    GENERIC_COMMENT_TYPE,
    GENERIC_TASK_TYPE,
    getTaskAutoEstimation,
    MAX_GOLD_TO_EARN_BY_CHECK_TASKS,
    OPEN_STEP,
    RECURRENCE_ANNUALLY,
    RECURRENCE_DAILY,
    RECURRENCE_EVERY_2_WEEKS,
    RECURRENCE_EVERY_3_MONTHS,
    RECURRENCE_EVERY_3_WEEKS,
    RECURRENCE_EVERY_6_MONTHS,
    RECURRENCE_EVERY_WORKDAY,
    RECURRENCE_MONTHLY,
    RECURRENCE_NEVER,
    RECURRENCE_WEEKLY,
} from '../../../components/TaskListView/Utils/TasksHelper'
import {
    chronoKeysOrder,
    getCommentDirectionWhenMoveTaskInTheWorklfow,
    getWorkflowStepId,
    getWorkflowStepsIdsSorted,
} from '../../HelperFunctions'
import {
    FORDWARD_COMMENT,
    MENTION_SPACE_CODE,
    STAYWARD_COMMENT,
    updateNewAttachmentsData,
} from '../../../components/Feeds/Utils/HelperFunctions'
import { getUserWorkflow } from '../../../components/ContactsView/Utils/ContactsHelper'
import { updateXpByDoneForAllReviewers, updateXpByDoneTask } from '../../Levels'
import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { tryToGenerateTopicAdvaice } from '../../assistantHelper'
import { getDvMainTabLink } from '../../LinkingHelper'
import { isPrivateNote } from '../../../components/NotesView/NotesHelper'
import { getGoalData } from '../Goals/goalsFirestore'
import { isPrivateGoal } from '../../../components/GoalsView/GoalsHelper'
import { getSkillData } from '../Skills/skillsFirestore'
import { isPrivateSkill } from '../../../components/SettingsView/Profile/Skills/SkillsHelper'
import { updateNotePrivacy, updateNoteTitleWithoutFeed } from '../Notes/notesFirestore'
import {
    updateChatAssistantWithoutFeeds,
    updateChatPrivacy,
    updateChatTitleWithoutFeeds,
} from '../Chats/chatsFirestore'
import { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY, createObjectMessage } from '../Chats/chatsComments'
import NavigationService from '../../NavigationService'
import { DV_TAB_ROOT_TASKS, DV_TAB_TASK_PROPERTIES } from '../../TabNavigationConstants'
import { getRoundedStartAndEndDates } from '../../../components/MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import { getCalendarTaskStartAndEndTimestamp } from '../../../components/MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksIntervals'
import { getAssistant } from '../../../components/AdminPanel/Assistants/assistantsHelper'

export async function watchTask(projectId, taskId, watcherKey, callback) {
    globalWatcherUnsub[watcherKey] = getDb()
        .doc(`items/${projectId}/tasks/${taskId}`)
        .onSnapshot(doc => {
            const taskData = doc.data()
            const task = taskData ? mapTaskData(doc.id, taskData) : null
            callback(task)
        })
}

export const updateTaskEditionData = async (projectId, taskId, editorId) => {
    await getDb().runTransaction(async transaction => {
        const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)
        const doc = await transaction.get(ref)
        if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
    })
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

export async function updateTaskData(projectId, taskId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

async function updateTaskDataDirectly(projectId, taskId, data, batch) {
    const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

const storeLastAddedTaskId = taskId => {
    store.dispatch(setLastTaskAddedId(taskId))
}

const scheduleResetLastAddedTaskId = taskId => {
    setTimeout(() => {
        const { lastTaskAddedId } = store.getState()
        if (lastTaskAddedId === taskId) {
            store.dispatch(setLastTaskAddedId(''))
        }
    }, 5000)
}

export async function uploadNewTask(
    projectId,
    task,
    linkBack,
    awaitForTaskCreation,
    tryToGenerateBotAdvaice,
    notGenerateMentionTasks,
    notGenerateUpdates
) {
    if (task && task.name && task.name.trim()) {
        const taskId = task.id ? task.id : getId()
        const taskCopy = { ...task }
        delete taskCopy.id

        // Initialize task fields if not present
        taskCopy.name = taskCopy.name.trim()
        taskCopy.extendedName = taskCopy.extendedName ? taskCopy.extendedName.trim() : taskCopy.name
        taskCopy.description = taskCopy.description ? taskCopy.description : ''
        taskCopy.userId = taskCopy.userId ? taskCopy.userId : ''
        taskCopy.userIds = [taskCopy.userId]
        taskCopy.currentReviewerId = taskCopy.userId
        taskCopy.observersIds = taskCopy.observersIds ? taskCopy.observersIds : []
        taskCopy.dueDateByObserversIds = taskCopy.dueDateByObserversIds ? taskCopy.dueDateByObserversIds : {}
        taskCopy.estimationsByObserverIds = taskCopy.estimationsByObserverIds ? taskCopy.estimationsByObserverIds : {}
        taskCopy.stepHistory = [OPEN_STEP]
        taskCopy.hasStar = taskCopy.hasStar ? taskCopy.hasStar : '#FFFFFF'
        taskCopy.created = taskCopy.created ? taskCopy.created : Date.now()
        taskCopy.creatorId = taskCopy.creatorId ? taskCopy.creatorId : ''
        taskCopy.dueDate = taskCopy.dueDate ? taskCopy.dueDate : Date.now()
        taskCopy.completed = taskCopy.completed ? taskCopy.completed : null
        taskCopy.isPrivate = taskCopy.isPrivate ? taskCopy.isPrivate : false
        taskCopy.isPublicFor = taskCopy.isPublicFor ? taskCopy.isPublicFor : [FEED_PUBLIC_FOR_ALL, taskCopy.userId]
        taskCopy.parentId = taskCopy.parentId ? taskCopy.parentId : null
        taskCopy.isSubtask = taskCopy.isSubtask ? taskCopy.isSubtask : false
        taskCopy.subtaskIds = taskCopy.subtaskIds ? taskCopy.subtaskIds : []
        taskCopy.subtaskNames = taskCopy.subtaskNames ? taskCopy.subtaskNames : []
        taskCopy.recurrence = taskCopy.recurrence ? taskCopy.recurrence : RECURRENCE_NEVER
        taskCopy.startDate = taskCopy.startDate ? taskCopy.startDate : taskCopy.created
        taskCopy.startTime = taskCopy.startTime ? taskCopy.startTime : moment(taskCopy.created).format('HH:mm')
        taskCopy.lastEditorId = taskCopy.lastEditorId ? taskCopy.lastEditorId : ''
        taskCopy.lastEditionDate = taskCopy.lastEditionDate ? taskCopy.lastEditionDate : Date.now()
        taskCopy.linkBack = linkBack ? linkBack : ''
        taskCopy.estimations = taskCopy.estimations ? taskCopy.estimations : { [OPEN_STEP]: ESTIMATION_0_MIN }
        taskCopy.comments = taskCopy.comments ? taskCopy.comments : []
        taskCopy.genericData = taskCopy.genericData ? taskCopy.genericData : null
        taskCopy.sortIndex = taskCopy.sortIndex ? taskCopy.sortIndex : generateNegativeSortIndex()
        taskCopy.linkedParentNotesIds = taskCopy.linkedParentNotesIds ? taskCopy.linkedParentNotesIds : []
        taskCopy.linkedParentTasksIds = taskCopy.linkedParentTasksIds ? taskCopy.linkedParentTasksIds : []
        taskCopy.linkedParentContactsIds = taskCopy.linkedParentContactsIds ? taskCopy.linkedParentContactsIds : []
        taskCopy.linkedParentProjectsIds = taskCopy.linkedParentProjectsIds ? taskCopy.linkedParentProjectsIds : []
        taskCopy.linkedParentGoalsIds = taskCopy.linkedParentGoalsIds ? taskCopy.linkedParentGoalsIds : []
        taskCopy.linkedParentSkillsIds = taskCopy.linkedParentSkillsIds ? taskCopy.linkedParentSkillsIds : []
        taskCopy.linkedParentAssistantIds = taskCopy.linkedParentAssistantIds ? taskCopy.linkedParentAssistantIds : []
        taskCopy.parentDone = taskCopy.parentDone ? taskCopy.parentDone : false
        taskCopy.suggestedBy = taskCopy.suggestedBy ? taskCopy.suggestedBy : null
        taskCopy.parentGoalId = taskCopy.parentGoalId ? taskCopy.parentGoalId : null
        taskCopy.parentGoalIsPublicFor = taskCopy.parentGoalIsPublicFor ? taskCopy.parentGoalIsPublicFor : null
        taskCopy.noteId = taskCopy.noteId ? taskCopy.noteId : null
        taskCopy.containerNotesIds = taskCopy.containerNotesIds ? taskCopy.containerNotesIds : []
        taskCopy.calendarData = taskCopy.calendarData ? taskCopy.calendarData : null
        taskCopy.gmailData = taskCopy.gmailData ? taskCopy.gmailData : null
        taskCopy.timesPostponed = taskCopy.timesPostponed ?? 0
        taskCopy.timesFollowed = taskCopy.timesFollowed ?? 0
        taskCopy.timesDoneInExpectedDay = taskCopy.timesDoneInExpectedDay ?? 0
        taskCopy.timesDone = taskCopy.timesDone ?? 0
        taskCopy.isPremium = taskCopy.isPremium ? taskCopy.isPremium : false
        taskCopy.lockKey = taskCopy.lockKey ? taskCopy.lockKey : ''
        taskCopy.assigneeType = taskCopy.assigneeType ? taskCopy.assigneeType : TASK_ASSIGNEE_USER_TYPE
        taskCopy.assistantId = taskCopy.assistantId ? taskCopy.assistantId : ''
        taskCopy.commentsData = taskCopy.commentsData ? taskCopy.commentsData : null
        taskCopy.autoEstimation =
            taskCopy.autoEstimation === false || taskCopy.autoEstimation === true ? taskCopy.autoEstimation : null
        taskCopy.completedTime = taskCopy.completedTime ? taskCopy.completedTime : null
        // Task-level AI settings that can override assistant settings
        taskCopy.aiModel = taskCopy.aiModel || null
        taskCopy.aiTemperature = taskCopy.aiTemperature || null
        taskCopy.aiSystemMessage = taskCopy.aiSystemMessage || null

        updateEditionData(taskCopy)

        const { loggedUser } = store.getState()

        storeLastAddedTaskId(taskId)

        const contact = TasksHelper.getContactInProject(projectId, taskCopy.userId)
        if (contact && !taskCopy.observersIds.includes(loggedUser.uid)) {
            taskCopy.observersIds.push(loggedUser.uid)
        }

        const isTemplateProject = loggedUser.templateProjectIds.includes(projectId)
        taskCopy.sortIndex = isTemplateProject ? generateNegativeSortIndex() : generateSortIndex()

        const { dueDateByObserversIds, estimationsByObserverIds } = TasksHelper.getDueDateAndEstimationsByObserversIds(
            taskCopy.observersIds
        )
        taskCopy.dueDateByObserversIds = dueDateByObserversIds
        taskCopy.estimationsByObserverIds = estimationsByObserverIds

        delete taskCopy.projectId

        if (!notGenerateUpdates) creatTaskFeedChain(projectId, taskId, taskCopy)

        const project = ProjectHelper.getProjectById(projectId)
        const fullText = taskCopy.extendedName + ' ' + taskCopy.description
        const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(fullText, ''))

        if (tryToGenerateBotAdvaice) {
            const followerIds = uniq([...mentionedUserIds, taskCopy.userId, taskCopy.creatorId])
            tryToGenerateTopicAdvaice(
                projectId,
                taskId,
                'tasks',
                taskCopy.isPublicFor,
                taskCopy.extendedName,
                followerIds,
                taskCopy.assistantId,
                taskCopy.creatorId
            )
        }

        if (!notGenerateMentionTasks) {
            createGenericTaskWhenMention(
                projectId,
                taskId,
                mentionedUserIds,
                GENERIC_TASK_TYPE,
                'tasks',
                taskCopy.assistantId
            )
        }

        awaitForTaskCreation
            ? await getDb()
                  .doc(`items/${projectId}/tasks/${taskId}`)
                  .set(taskCopy)
                  .then(() => {
                      scheduleResetLastAddedTaskId(taskId)
                  })
            : getDb()
                  .doc(`items/${projectId}/tasks/${taskId}`)
                  .set(taskCopy)
                  .then(() => {
                      scheduleResetLastAddedTaskId(taskId)
                  })

        logEvent('new_task', {
            taskOwnerUid: taskCopy.userId,
            estimation: taskCopy.estimations[OPEN_STEP],
        })
        return mapTaskData(taskId, taskCopy)
    }
    return null
}

export async function uploadNewSubTask(projectId, task, newSubTask, inFollowUpProcess, tryToGenerateBotAdvaice) {
    const subTask = { ...newSubTask }

    if (task && task.name && task.name.trim() !== '') {
        const batch = new BatchWrapper(getDb())

        delete subTask.id
        const newTaskId = getId()

        subTask.parentId = task.id
        subTask.isSubtask = true
        subTask.userId = task.userId
        subTask.userIds = task.userIds
        subTask.currentReviewerId = task.currentReviewerId
        subTask.stepHistory = task.stepHistory
        subTask.sortIndex = generateNegativeSortTaskIndex()
        subTask.parentDone = task.done
        subTask.inDone = task.inDone
        subTask.dueDate = task.dueDate
        subTask.completed = task.completed
        subTask.observersIds = task.observersIds
        subTask.dueDateByObserversIds = task.dueDateByObserversIds
        subTask.estimationsByObserverIds = task.estimationsByObserverIds
        subTask.parentGoalId = task.parentGoalId
        subTask.parentGoalIsPublicFor = task.parentGoalIsPublicFor
        subTask.lockKey = task.lockKey
        subTask.assistantId = task.assistantId

        updateEditionData(subTask)
        batch.set(getDb().collection(`items/${projectId}/tasks`).doc(newTaskId), {
            ...subTask,
            name: subTask.name.toLowerCase(),
        })

        updateTaskData(
            projectId,
            task.id,
            { subtaskIds: [...task.subtaskIds, newTaskId], subtaskNames: [...task.subtaskNames, subTask.name] },
            batch
        )

        batch.commit()

        subTask.id = newTaskId
        uploadNewSubTaskFeedsChain(projectId, task, subTask, inFollowUpProcess)

        const project = ProjectHelper.getProjectById(projectId)
        const fullText = subTask.extendedName + ' ' + subTask.description
        const mentionedUserIds = intersection(project.userIds, getMentionedUsersIdsWhenEditText(fullText, ''))

        if (tryToGenerateBotAdvaice) {
            const followerIds = uniq([...mentionedUserIds, subTask.userId, subTask.creatorId])
            tryToGenerateTopicAdvaice(
                projectId,
                newTaskId,
                'tasks',
                subTask.isPublicFor,
                subTask.extendedName,
                followerIds,
                subTask.assistantId,
                task.creatorId
            )
        }

        logEvent('new_task', {
            taskOwnerUid: task.userId,
            estimation: task.estimations[OPEN_STEP],
            isSubtask: true,
        })
        return mapTaskData(newTaskId, subTask)
    }

    return null
}

export async function createRecurrentTask(projectId, taskId) {
    const task = await getTaskData(projectId, taskId)
    const recurrence = task.recurrence

    if (recurrence !== RECURRENCE_NEVER) {
        const startMoment = moment(task.startDate || task.created)
        const startTime = task.startTime || startMoment.format('HH:mm')
        const [hours, minutes] = startTime.split(':').map(Number)

        // Use the current moment as the base
        let baseDate = moment()
        // Set the time to match the original task's scheduled time
        baseDate = baseDate.hour(hours).minute(minutes)

        const recurrenceMap = {
            [RECURRENCE_DAILY]: baseDate.clone().add(1, 'days'),
            [RECURRENCE_EVERY_WORKDAY]: (() => {
                let date = baseDate.clone()
                // if today is Friday, Saturday or Sunday
                const today = date.isoWeekday()
                if (today >= 5) {
                    // Set the date as monday of next week
                    date.add(1, 'weeks').isoWeekday(1)
                } else {
                    // Set the date as the next day
                    date.add(1, 'days')
                }
                return date
            })(),
            [RECURRENCE_WEEKLY]: baseDate.clone().add(1, 'weeks'),
            [RECURRENCE_EVERY_2_WEEKS]: baseDate.clone().add(2, 'weeks'),
            [RECURRENCE_EVERY_3_WEEKS]: baseDate.clone().add(3, 'weeks'),
            [RECURRENCE_MONTHLY]: baseDate.clone().add(1, 'months'),
            [RECURRENCE_EVERY_3_MONTHS]: baseDate.clone().add(3, 'months'),
            [RECURRENCE_EVERY_6_MONTHS]: baseDate.clone().add(6, 'months'),
            [RECURRENCE_ANNUALLY]: baseDate.clone().add(1, 'years'),
        }

        delete task.id

        const endOfToday = moment().endOf('day').valueOf()
        const endExpectedDay = moment(task.dueDate).endOf('day').valueOf()
        if (endOfToday <= endExpectedDay) {
            task.timesDoneInExpectedDay += 1
        } else {
            task.timesDoneInExpectedDay = 0
        }
        task.timesDone += 1

        task.done = false
        task.inDone = false
        task.created = moment().valueOf()
        const nextDate = recurrenceMap[recurrence]
        task.startDate = nextDate.valueOf()
        task.startTime = startTime
        task.dueDate = nextDate.valueOf()
        task.completed = null
        task.comments = []
        task.timesPostponed = 0
        task.completedTime = null
        task.lockKey = ''

        // When the task to delete is a sub task
        if (task.parentId !== null) {
            deleteSubTaskFromParent(projectId, taskId, task)
        }
        task.parentId = null
        task.isSubtask = false

        const subtaskIds = cloneDeep(task.subtaskIds)
        task.subtaskIds = []

        uploadNewTask(projectId, task, null, null, false, false, false).then(newTask => {
            if (subtaskIds !== null && subtaskIds.length > 0) {
                createSubtasksCopies(
                    projectId,
                    projectId,
                    newTask.id,
                    newTask,
                    subtaskIds,
                    { timesPostponed: 0 },
                    false,
                    true
                )
            }

            updateTaskData(
                projectId,
                taskId,
                { recurrence: RECURRENCE_NEVER, timesDoneInExpectedDay: 0, timesDone: 0 },
                null
            )
        })
    }
}

export async function uploadTaskByQuill(projectId, task, externalBatch) {
    updateEditionData(task)
    const taskId = task.id
    task.sortIndex = generateSortIndex()
    delete task.id
    externalBatch.set(getDb().doc(`items/${projectId}/tasks/${taskId}`), task)
}

export function createGenericTaskWhenMention(
    projectId,
    parentObjectId,
    mentionedUserIds,
    genericType,
    parentType,
    assistantId
) {
    if (mentionedUserIds.length > 0) {
        const { loggedUser } = store.getState()
        const { uid, displayName } = loggedUser

        const nonDuplicatedMentionedUsersIds = []

        mentionedUserIds.map(uid => {
            if (!nonDuplicatedMentionedUsersIds.includes(uid) && TasksHelper.getUserInProject(projectId, uid)) {
                nonDuplicatedMentionedUsersIds.push(uid)
            }
        })
        const path = `${window.location.origin}${getDvMainTabLink(
            projectId,
            parentObjectId,
            parentType === 'topics' ? 'chats' : parentType
        )}`
        const generic = genericType === GENERIC_COMMENT_TYPE ? `&Comment of ` : ''

        nonDuplicatedMentionedUsersIds.forEach(async userId => {
            let isPrivate = false
            if (parentType === 'tasks') {
                const task = await getTaskData(projectId, parentObjectId)
                isPrivate = TasksHelper.isPrivateTask(task, { uid: userId })
            } else if (parentType === 'notes') {
                const note = await getNoteMeta(projectId, parentObjectId)
                isPrivate = isPrivateNote(note, { uid: userId })
            } else if (parentType === 'goals') {
                const goal = await getGoalData(projectId, parentObjectId)
                isPrivate = isPrivateGoal(goal, userId)
            } else if (parentType === 'skills') {
                const skill = await getSkillData(projectId, parentObjectId)
                isPrivate = isPrivateSkill(skill, userId)
            }

            if (!isPrivate) {
                const genericTask = TasksHelper.getNewDefaultTask()

                genericTask.userId = userId
                genericTask.userIds = [userId]
                genericTask.currentReviewerId = userId
                genericTask.name = `@${displayName}  in ${generic}${path}`.toLowerCase()
                genericTask.extendedName = `@${displayName.replaceAll(' ', MENTION_SPACE_CODE)}${
                    loggedUser.isAnonymous ? '' : `#${uid}`
                }  in ${generic}${path}`
                genericTask.genericData = {
                    genericType,
                    parentType,
                    parentObjectId,
                    assistantId,
                }
                genericTask.sortIndex = generateSortIndex()
                updateEditionData(genericTask)
                uploadNewTask(projectId, genericTask, null, null, false, true, false)
            }
        })
    }
}

const updateLastAssistantCommentData = (projectId, newTaskId, creatorId, batch) => {
    const { loggedUser } = store.getState()

    const updateDate = {
        objectType: 'tasks',
        objectId: newTaskId,
        creatorId,
        creatorType: getAssistant(creatorId) ? 'assistant' : 'user',
        date: moment().utc().valueOf(),
    }

    batch.update(getDb().doc(`users/${loggedUser.uid}`), {
        [`lastAssistantCommentData.${projectId}`]: { updateDate },
        [`lastAssistantCommentData.${ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY}`]: {
            ...updateDate,
            projectId,
        },
    })
}

async function copyChatsForFolloupTaskAndGenerateCommentsData(projectId, oldTaskId, newTaskId) {
    let commentsData = null

    const oldChat = (await getDb().doc(`chatObjects/${projectId}/chats/${oldTaskId}`).get()).data()

    if (oldChat) {
        let lastCommentOwnerId = ''

        const commentDocs = await getDb().collection(`chatComments/${projectId}/tasks/${oldTaskId}/comments`).get()

        commentsData =
            commentDocs.docs.length > 0
                ? {
                      lastComment: '',
                      lastCommentType: STAYWARD_COMMENT,
                      amount: 0,
                  }
                : null

        const batch = new BatchWrapper(getDb())

        commentDocs.forEach(doc => {
            const comment = doc.data()
            if (!comment.commentText.includes('Follow up task created')) {
                commentsData.lastComment = comment.commentText
                commentsData.amount++
                lastCommentOwnerId = comment.creatorId
                batch.set(getDb().doc(`chatComments/${projectId}/tasks/${newTaskId}/comments/${doc.id}`), comment)
            }
        })

        updateLastAssistantCommentData(projectId, newTaskId, lastCommentOwnerId, batch)

        batch.set(getDb().doc(`chatObjects/${projectId}/chats/${newTaskId}`), {
            ...oldChat,
            commentsData: { ...commentsData, lastCommentOwnerId },
        })
        await batch.commit()
    }

    return commentsData
}

export async function createFollowUpTask(projectId, task, dueDate, comment, newEstimation) {
    const { loggedUser } = store.getState()

    const newTaskId = getId()

    const commentsData = await copyChatsForFolloupTaskAndGenerateCommentsData(projectId, task.id, newTaskId)

    const followUpTask = {
        ...TasksHelper.getNewDefaultTask(),
        id: newTaskId,
        creatorId: loggedUser.uid,
        dueDate: dueDate,
        hasStar: task.hasStar,
        isPrivate: task.isPrivate,
        isPublicFor: task.isPublicFor,
        name: `#FollowUp ${task.name.replace(/#FollowUp/g, '')}`.toLowerCase(),
        extendedName: `#FollowUp ${(task.extendedName || task.name).replace(/#FollowUp/g, '')}`,
        userId: task.userId,
        userIds: [task.userId],
        currentReviewerId: task.userId,
        observersIds: task.observersIds,
        dueDateByObserversIds: task.dueDateByObserversIds,
        estimationsByObserverIds: task.estimationsByObserverIds,
        linkedParentTasksIds: task.linkedParentTasksIds,
        linkedParentNotesIds: task.linkedParentNotesIds,
        parentGoalId: task.parentGoalId,
        parentGoalIsPublicFor: task.parentGoalIsPublicFor,
        lockKey: task.lockKey,
        timesFollowed: task.timesFollowed ? task.timesFollowed + 1 : 1,
        commentsData,
        ...(task.noteId && { noteId: task.noteId }),
    }

    await uploadNewTask(projectId, followUpTask, null, null, true, true, true)

    updateTaskData(projectId, task.id, { timesFollowed: firebase.firestore.FieldValue.increment(1) }, null)

    if (task.subtaskIds && task.subtaskIds.length > 0) {
        createSubtasksCopies(projectId, projectId, newTaskId, followUpTask, [...task.subtaskIds], null, true, true)
    }

    const linkToNewTask = `${window.location.origin}/projects/${projectId}/tasks/${newTaskId}/properties`
    const commentOldTask = `Follow up task created: ${linkToNewTask}`
    createObjectMessage(projectId, task.id, commentOldTask, 'tasks', STAYWARD_COMMENT, null, null)

    if (comment && comment.trim()) {
        createObjectMessage(projectId, task.id, comment, 'tasks', STAYWARD_COMMENT, null, null)
        createObjectMessage(projectId, newTaskId, comment, 'tasks', STAYWARD_COMMENT, null, null)
    }

    createFollowUpBacklinksToNotes(projectId, newTaskId, task.id)

    creatFollowUpTaskFeedChain(projectId, task, newEstimation, followUpTask, newTaskId)
}

export async function updateTask(projectId, task, oldTask, oldAssignee, comment, commentMentions, isObservedTask) {
    // console.log(
    //     '[tasksFirestore updateTask] Entry. Task ID:',
    //     task?.id,
    //     'New dueDate:',
    //     task?.dueDate,
    //     'Old dueDate:',
    //     oldTask?.dueDate
    // )
    // console.log('[tasksFirestore updateTask] Full new task:', JSON.stringify(task), 'Full old task:', JSON.stringify(oldTask));

    const taskId = task.id
    const newAssignee = TasksHelper.getTaskOwner(task.userId, projectId)

    const taskToStore = { ...task, name: task.name.toLowerCase() }
    delete taskToStore.id
    delete taskToStore.time
    delete taskToStore.projectId

    const taskGoToDifferentList =
        task.userId !== oldTask.userId ||
        task.dueDate !== oldTask.dueDate ||
        task.parentGoalId !== oldTask.parentGoalId ||
        (task.parentId && task.recurrence !== oldTask.recurrence)
    if (taskGoToDifferentList) {
        taskToStore.sortIndex = generateSortIndex()
    }

    const needToPromoteSubtask = task.parentId && taskGoToDifferentList
    if (needToPromoteSubtask) {
        deleteSubTaskFromParent(projectId, taskId, task)
        taskToStore.parentId = null
        taskToStore.isSubtask = false
    }

    const batch = new BatchWrapper(getDb())

    if (task.parentId && !needToPromoteSubtask) {
        const parentRef = getDb().doc(`items/${projectId}/tasks/${task.parentId}`)
        const parentTask = (await parentRef.get()).data()

        let { subtaskIds, subtaskNames } = parentTask
        const subtaskIndex = subtaskIds.indexOf(task.id)
        subtaskNames[subtaskIndex] = task.name

        batch.update(parentRef, { subtaskNames })
    }

    const observersWereUpdated = !isEqual(task.observersIds, oldTask.observersIds)
    if (observersWereUpdated) {
        const {
            dueDateByObserversIds,
            estimationsByObserverIds,
        } = TasksHelper.mergeDueDateAndEstimationsByObserversIds(
            oldTask.dueDateByObserversIds,
            taskToStore.observersIds,
            oldTask.estimationsByObserverIds
        )

        taskToStore.dueDateByObserversIds = dueDateByObserversIds
        taskToStore.estimationsByObserverIds = estimationsByObserverIds
    }

    if (task.userId !== oldTask.userId && task.userId === task.suggestedBy) {
        taskToStore.suggestedBy = null
    }

    if (!isEqual(task.isPublicFor, oldTask.isPublicFor)) {
        updateChatPrivacy(projectId, task.id, 'tasks', task.isPublicFor)
        if (task.noteId) {
            getObjectFollowersIds(projectId, 'tasks', task.id).then(followersIds => {
                updateNotePrivacy(projectId, task.noteId, task.isPrivate, task.isPublicFor, followersIds, false, null)
            })
        }
    }

    if (task.recurrence === RECURRENCE_NEVER) {
        taskToStore.timesDoneInExpectedDay = 0
        taskToStore.timesDone = 0
    }

    const subtasksUpdateData = {
        isPrivate: taskToStore.isPrivate,
        isPublicFor: taskToStore.isPublicFor,
        dueDate: taskToStore.dueDate,
        observersIds: taskToStore.observersIds,
        dueDateByObserversIds: taskToStore.dueDateByObserversIds,
        estimationsByObserverIds: taskToStore.estimationsByObserverIds,
        parentGoalId: taskToStore.parentGoalId,
        parentGoalIsPublicFor: taskToStore.parentGoalIsPublicFor,
        lockKey: taskToStore.lockKey,
        suggestedBy: taskToStore.suggestedBy,
    }

    if (task.userId !== oldTask.userId) {
        subtasksUpdateData.userId = newAssignee.uid
        subtasksUpdateData.userIds = [newAssignee.uid]
        subtasksUpdateData.currentReviewerId = newAssignee.uid
    }

    if (task.dueDate > oldTask.dueDate) {
        taskToStore.timesPostponed = firebase.firestore.FieldValue.increment(1)
        subtasksUpdateData.timesPostponed = firebase.firestore.FieldValue.increment(1)
        logEvent('task_postponed')
    }

    const endOfToday = moment().endOf('day').valueOf()
    if (endOfToday < task.dueDate) {
        const assignee = TasksHelper.getUserInProject(projectId, task.userId)
        if (assignee && assignee.inFocusTaskId === task.id) updateFocusedTask(task.userId, projectId, null, null, null)
    }

    updateSubtasksState(projectId, task.subtaskIds, subtasksUpdateData, batch)
    updateTaskData(projectId, taskId, taskToStore, batch)

    // change statistic if task is Done
    if (task.done) {
        const oldEstimation = oldTask.estimations[OPEN_STEP] ? oldTask.estimations[OPEN_STEP] : 0
        const newEstimation = task.estimations[OPEN_STEP] ? task.estimations[OPEN_STEP] : 0

        if (newEstimation !== oldEstimation) {
            // Need to do two operation.
            // Doing only one operation with "newEstimation - oldEstimation" as parameter
            // will cause the Points estimation may not be accurate,
            // and resultant Point in BD may not MATCH with defined Points/Time constants
            updateStatistics(projectId, task.userId, oldEstimation, true, true, task.completed, batch)
            updateStatistics(projectId, task.userId, newEstimation, false, true, task.completed, batch)
        }
    }

    batch.commit()

    updateTaskFeedsChain(
        projectId,
        task,
        oldTask,
        oldAssignee,
        comment,
        commentMentions,
        taskId,
        newAssignee,
        isObservedTask
    )
}

export const setTaskAssistant = async (projectId, taskId, assistantId, needGenerateUpdate) => {
    const batch = new BatchWrapper(getDb())
    updateTaskData(projectId, taskId, { assistantId }, batch)
    await updateChatAssistantWithoutFeeds(projectId, taskId, assistantId, batch)
    batch.commit()
    if (needGenerateUpdate) createTaskAssistantChanged(projectId, assistantId, taskId, null, null)
}

export const setTaskNote = async (projectId, taskId, noteId) => {
    updateTaskData(projectId, taskId, { noteId }, null)
}

export async function setTaskPrivacy(projectId, taskId, isPrivate, isPublicFor, task) {
    updateTaskData(projectId, taskId, { isPrivate: isPrivate, isPublicFor: isPublicFor }, null)
    updateChatPrivacy(projectId, taskId, 'tasks', isPublicFor)
    if (task.noteId) {
        const followersIds = await getObjectFollowersIds(projectId, 'tasks', task.id)
        updateNotePrivacy(projectId, task.noteId, isPrivate, isPublicFor, followersIds, false, null)
    }
    task.subtaskIds.forEach(subtaskId => {
        setSubtaskPrivacy(projectId, subtaskId, isPrivate, isPublicFor)
    })

    const batch = new BatchWrapper(getDb())
    await createTaskPrivacyChangedFeed(projectId, taskId, isPrivate, isPublicFor, batch)
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)
    createMentionTasksAfterSetTaskPublic(projectId, task, isPrivate, isPublicFor)
    batch.commit()
}

export function setSubtaskPrivacy(projectId, taskId, isPrivate, isPublicFor) {
    updateTaskData(
        projectId,
        taskId,
        {
            isPrivate: isPrivate,
            isPublicFor: isPublicFor,
        },
        null
    )
}

export async function setTaskRecurrence(projectId, taskId, recurrence, task) {
    if (task.recurrence !== recurrence) {
        const batch = new BatchWrapper(getDb())
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: taskId,
            followObject: task,
            feedCreator: store.getState().loggedUser,
        }
        await tryAddFollower(projectId, followTaskData, batch)
        await createTaskRecurrenceChangedFeed(projectId, task, taskId, task.recurrence, recurrence)

        // When the task to update is a sub task
        if (task.parentId) {
            await deleteSubTaskFromParent(projectId, taskId, task, batch)
            updateTaskData(
                projectId,
                taskId,
                {
                    parentId: null,
                    isSubtask: false,
                    recurrence: recurrence,
                    sortIndex: generateSortIndex(),
                },
                batch
            )
        } else {
            const updateData = { recurrence: recurrence }
            if (recurrence === RECURRENCE_NEVER) {
                updateData.timesDoneInExpectedDay = 0
                updateData.timesDone = 0
            }
            updateTaskData(projectId, taskId, updateData, batch)
        }
        batch.commit()
        task.recurrence = recurrence
    }
}

export async function setTaskHighlight(projectId, taskId, highlightColor, task) {
    const batch = new BatchWrapper(getDb())
    const isHighlight = highlightColor.toLowerCase() !== '#ffffff'

    await createTaskHighlightedChangedFeed(projectId, task, taskId, isHighlight, batch)
    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)

    updateTaskData(projectId, taskId, { hasStar: highlightColor }, batch)
    batch.commit()
}

export async function setTaskHighlightMultiple(highlightColor, tasks) {
    const batch = new BatchWrapper(getDb())
    const taskBatch = new BatchWrapper(getDb())
    const isHighlight = highlightColor.toLowerCase() !== '#ffffff'

    for (let task of tasks) {
        updateTaskData(task.projectId, task.id, { hasStar: highlightColor }, taskBatch)
    }
    taskBatch.commit()

    for (let task of tasks) {
        await createTaskHighlightedChangedFeed(task.projectId, task, task.id, isHighlight, batch)
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: task.id,
            followObject: task,
            feedCreator: store.getState().loggedUser,
        }
        await tryAddFollower(task.projectId, followTaskData, batch)
    }
    batch.commit()
}

export async function setTaskObserverEstimations(projectId, taskId, oldEstimation, newEstimation, observerId) {
    updateTaskData(projectId, taskId, { [`estimationsByObserverIds.${observerId}`]: newEstimation }, null)
    createTaskObserverEstimationChangedFeed(projectId, taskId, oldEstimation, newEstimation)
}

export async function setTaskEstimations(projectId, taskId, task, stepId, estimation) {
    const oldEstimation = task.estimations[stepId] ? task.estimations[stepId] : 0

    const batch = new BatchWrapper(getDb())
    if (oldEstimation !== estimation && stepId === OPEN_STEP && task.done) {
        // Need to do two operation.
        // Doing only one operation with "newEstimation - oldEstimation" as parameter
        // will cause the Points estimation may not be accurate,
        // and resultant Point in BD may not MATCH with defined Points/Time constants
        updateStatistics(projectId, task.userId, oldEstimation, true, true, task.completed, batch)
        updateStatistics(projectId, task.userId, estimation, false, true, task.completed, batch)
    }

    updateTaskData(projectId, task.id, { [`estimations.${stepId}`]: estimation }, batch)

    batch.commit()

    setFutureEstimationsFeedChain(projectId, taskId, task, stepId, estimation, oldEstimation)
}

async function setFutureEstimationsFeedChain(projectId, taskId, task, stepId, estimation, oldEstimation) {
    const batch = new BatchWrapper(getDb())

    stepId === OPEN_STEP
        ? await createTaskAssigneeEstimationChangedFeed(projectId, taskId, oldEstimation, estimation, batch)
        : await createTaskReviewerEstimationChangedFeed(
              projectId,
              task,
              taskId,
              oldEstimation,
              estimation,
              stepId,
              batch
          )

    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: taskId,
        followObject: task,
        feedCreator: store.getState().loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)

    batch.commit()
}

export async function setTaskName(projectId, taskId, name, task, oldName) {
    const cleanedName = TasksHelper.getTaskNameWithoutMeta(name)

    const batch = new BatchWrapper(getDb())

    const mentionedUserIds = getMentionedUsersIdsWhenEditText(name, oldName)
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], taskId, batch)

    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        taskId,
        name,
        oldName,
        GENERIC_TASK_TYPE,
        'tasks',
        task.assistantId
    )

    updateTaskData(projectId, taskId, { name: cleanedName, extendedName: name.trim() }, batch)

    if (task.noteId) {
        await updateNoteTitleWithoutFeed(projectId, task.noteId, name, batch)
    }
    await updateChatTitleWithoutFeeds(projectId, taskId, name, batch)

    if (task.parentId) {
        const parentRef = getDb().doc(`items/${projectId}/tasks/${task.parentId}`)
        const parentTask = (await parentRef.get()).data()

        let { subtaskIds, subtaskNames } = parentTask
        const subtaskIndex = subtaskIds.indexOf(task.id)
        subtaskNames[subtaskIndex] = name

        updateTaskData(projectId, task.parentId, { subtaskNames }, batch)
    }

    await createTaskNameChangedFeed(projectId, task, oldName, name, taskId, batch)

    await processFollowersWhenEditTexts(projectId, FOLLOWER_TASKS_TYPE, taskId, task, mentionedUserIds, true, batch)

    batch.commit()
}

export async function setTaskDescription(projectId, taskId, description, task, oldDescription) {
    createGenericTaskWhenMentionInTitleEdition(
        projectId,
        taskId,
        description,
        oldDescription,
        GENERIC_TASK_TYPE,
        'tasks',
        task.assistantId
    )

    const batch = new BatchWrapper(getDb())

    updateTaskData(projectId, taskId, { description }, batch)
    const mentionedUserIds = getMentionedUsersIdsWhenEditText(description, oldDescription)
    insertFollowersUserToFeedChain(mentionedUserIds, [], [], taskId, batch)
    await createTaskDescriptionChangedFeed(projectId, task, oldDescription, description, taskId, batch)
    await processFollowersWhenEditTexts(projectId, FOLLOWER_TASKS_TYPE, taskId, task, mentionedUserIds, true, batch)

    batch.commit()
}

export async function setTaskAutoEstimation(projectId, task, autoEstimation, batch) {
    const { loggedUser } = store.getState()

    updateTaskData(projectId, task.id, { autoEstimation }, batch)

    const followTaskData = {
        followObjectsType: FOLLOWER_TASKS_TYPE,
        followObjectId: task.id,
        followObject: task,
        feedCreator: loggedUser,
    }

    tryAddFollower(projectId, followTaskData)
}

export async function setTaskAutoEstimationMultiple(tasks, autoEstimation) {
    const batch = new BatchWrapper(getDb())
    for (const task of tasks) {
        setTaskAutoEstimation(task.projectId, task, autoEstimation, batch)
    }
    batch.commit()
}

export function unfocusTaskInUsers(projectId, unfocusData, externalBatch) {
    const batch = externalBatch || new BatchWrapper(getDb())
    unfocusData.forEach(data => {
        const { userId, sortIndex } = data
        updateFocusedTask(userId, projectId, null, sortIndex, batch)
    })
    if (!externalBatch) batch.commit()
}

export const generateSortIndexForTaskInFocus = () => {
    const GAP = 1000000000000000
    return Number.MAX_SAFE_INTEGER - GAP
}

const generateSortIndexForTaskInFocusInTime = () => {
    return generateSortIndexForTaskInFocus() + generateSortIndex()
}

export async function updateFocusedTask(
    userId,
    projectId,
    taskToSetFocusOn,
    sortIndexWhenUnfocusPrevious,
    externalBatch
) {
    // REMOVE LOGGING HERE
    // console.log(
    //     `[updateFocusedTask] Called. userId=${userId}, projectId=${projectId}, task.id=${taskToSetFocusOn?.id}, sortIndexWhenUnfocusPrevious=${sortIndexWhenUnfocusPrevious}`
    // )
    const assignee = TasksHelper.getUserInProject(projectId, userId) // projectId is of the taskToSetFocusOn or general context
    logEvent('focus_changed')

    if (assignee) {
        const batch = externalBatch || new BatchWrapper(getDb())

        if (taskToSetFocusOn) {
            // REMOVE LOGGING HERE
            // console.log(
            //     `[updateFocusedTask] Focusing task ${taskToSetFocusOn.id}. Calling setTaskDueDate with fromSetTaskFocus=true`
            // )
            // The projectId for setTaskDueDate should be the project of taskToSetFocusOn
            await setTaskDueDate(
                projectId,
                taskToSetFocusOn.id,
                moment().valueOf(),
                taskToSetFocusOn,
                false,
                batch,
                true
            )
            batch.update(getDb().doc(`items/${projectId}/tasks/${taskToSetFocusOn.id}`), {
                // Use projectId of taskToSetFocusOn
                sortIndex: generateSortIndexForTaskInFocusInTime(),
            })
        }

        if (assignee.inFocusTaskProjectId && assignee.inFocusTaskId) {
            // If there was a previously focused task
            // REMOVE LOGGING HERE
            // console.log(
            //     `[updateFocusedTask] Unfocusing previous task ${assignee.inFocusTaskId} in project ${assignee.inFocusTaskProjectId}.`
            // )
            const oldFocusedTaskRef = getDb().doc(
                `items/${assignee.inFocusTaskProjectId}/tasks/${assignee.inFocusTaskId}`
            )
            let sortIndexForOldTask

            if (sortIndexWhenUnfocusPrevious !== undefined && sortIndexWhenUnfocusPrevious !== null) {
                sortIndexForOldTask = sortIndexWhenUnfocusPrevious
            } else {
                // Default behavior: try to restore calendar sortIndex or use generic
                // Need to read the task data. If in a transaction (externalBatch exists), this read might need to be part of it or handled carefully.
                // For simplicity here, we'll assume non-transactional read if not explicitly passed, or that externalBatch handles gets.
                try {
                    // This read should ideally be consistent with the batch if externalBatch is a transaction
                    const oldFocusedTaskSnap = externalBatch
                        ? await externalBatch.get(oldFocusedTaskRef) // Assumes externalBatch can do gets if it's a transaction
                        : await oldFocusedTaskRef.get()

                    if (oldFocusedTaskSnap.exists) {
                        const oldFocusedTaskData = oldFocusedTaskSnap.data()
                        if (oldFocusedTaskData.calendarData && oldFocusedTaskData.calendarData.start) {
                            const oldCalStartTimeString =
                                oldFocusedTaskData.calendarData.start.dateTime ||
                                oldFocusedTaskData.calendarData.start.date
                            sortIndexForOldTask = moment(oldCalStartTimeString).valueOf()
                            // REMOVE LOGGING HERE
                            // console.log(`[updateFocusedTask] Restoring calendar sortIndex for ${assignee.inFocusTaskId}: ${sortIndexForOldTask}`);
                        } else {
                            sortIndexForOldTask = generateSortIndex()
                            // REMOVE LOGGING HERE
                            // console.log(`[updateFocusedTask] Setting generic sortIndex for ${assignee.inFocusTaskId}: ${sortIndexForOldTask}`);
                        }
                    } else {
                        // REMOVE LOGGING HERE
                        // console.warn(`[updateFocusedTask] Old focused task ${assignee.inFocusTaskId} not found for sortIndex update.`);
                        sortIndexForOldTask = generateSortIndex() // Fallback
                    }
                } catch (error) {
                    // console.error(`[updateFocusedTask] Error fetching old focused task ${assignee.inFocusTaskId}: `, error);
                    sortIndexForOldTask = generateSortIndex() // Fallback on error
                }
            }
            batch.update(oldFocusedTaskRef, { sortIndex: sortIndexForOldTask })
        }

        // Always provide valid string values for these fields
        // REMOVE LOGGING HERE
        // console.log(`[updateFocusedTask] Updating user ${userId} focus state: inFocusTaskId=${taskToSetFocusOn ? taskToSetFocusOn.id : ''}`)
        batch.update(getDb().doc(`users/${userId}`), {
            inFocusTaskId: taskToSetFocusOn ? taskToSetFocusOn.id : '',
            inFocusTaskProjectId: taskToSetFocusOn ? projectId : '', // Use projectId of taskToSetFocusOn
        })

        if (!externalBatch) await batch.commit()

        if (assignee.inFocusTaskId && (taskToSetFocusOn ? assignee.inFocusTaskId !== taskToSetFocusOn.id : true)) {
            // Avoid feed if unsetting and re-setting same task (though unlikely)
            createTaskFocusChangedFeed(assignee.inFocusTaskProjectId, assignee.inFocusTaskId, false, null, assignee)
        }
        if (taskToSetFocusOn) {
            createTaskFocusChangedFeed(
                projectId,
                taskToSetFocusOn.id,
                true,
                null,
                TasksHelper.getUserInProject(projectId, userId)
            ) // Use projectId of taskToSetFocusOn
        }
    }
}

export const updateTaskLastCommentData = async (projectId, taskId, lastComment, lastCommentType) => {
    getDb()
        .doc(`items/${projectId}/tasks/${taskId}`)
        .update({
            [`commentsData.lastComment`]: lastComment,
            [`commentsData.lastCommentType`]: lastCommentType,
            [`commentsData.amount`]: firebase.firestore.FieldValue.increment(1),
        })
}

export async function setTaskAssignee(
    projectId,
    taskId,
    uid,
    oldAssignee,
    newAssignee,
    task,
    generatedFeeds,
    externalBatch
) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    if (generatedFeeds) {
        const { loggedUser: feedCreator } = store.getState()
        const feedChainFollowersIds = [feedCreator.uid]
        addUniqueInstanceTypeToArray(feedChainFollowersIds, newAssignee.uid)
        batch.feedChainFollowersIds = { [taskId]: feedChainFollowersIds }

        await createTaskAssigneeChangedFeed(projectId, task, newAssignee, oldAssignee, taskId, batch)
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: taskId,
            followObject: task,
            feedCreator,
        }
        await tryAddFollower(projectId, followTaskData, batch)
        if (feedCreator.uid !== newAssignee.uid && !isWorkstream(newAssignee.uid)) {
            followTaskData.feedCreator = newAssignee
            await tryAddFollower(projectId, followTaskData, batch)
        }
    }

    if (task.parentId) {
        await deleteSubTaskFromParent(projectId, task.id, task, batch)
    }

    const isPublicFor = [...task.isPublicFor]
    if (
        !isPublicFor.includes(FEED_PUBLIC_FOR_ALL) &&
        !isPublicFor.includes(newAssignee.uid) &&
        !isWorkstream(newAssignee.uid)
    ) {
        isPublicFor.push(newAssignee.uid)
    }

    const sugestedData = uid === task.suggestedBy ? { suggestedBy: null } : { suggestedBy: task.suggestedBy }

    const newObserversIds = task.observersIds.filter(uid => uid !== newAssignee.uid)

    // Determine the sortIndex based on whether it's a calendar task
    let sortIndex
    if (task.calendarData && task.calendarData.start) {
        const { start } = task.calendarData
        sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
    } else {
        sortIndex = generateSortIndex()
    }

    if (task.userIds.length > 1) {
        // The task is in workflow, we need to reset the workflow back to open
        updateTaskData(
            projectId,
            taskId,
            {
                userId: uid,
                stepHistory: [OPEN_STEP],
                userIds: [uid],
                currentReviewerId: uid,
                parentId: null,
                isSubtask: false,
                isPublicFor: isPublicFor,
                observersIds: newObserversIds,
                sortIndex,
                ...sugestedData,
            },
            batch
        )
    } else {
        updateTaskData(
            projectId,
            taskId,
            {
                userId: uid,
                userIds: [uid],
                currentReviewerId: uid,
                parentId: null,
                isSubtask: false,
                isPublicFor: isPublicFor,
                sortIndex,
                observersIds: newObserversIds,
                ...sugestedData,
            },
            batch
        )
    }

    // change assignee of its subtasks
    if (task.subtaskIds?.length > 0) {
        for (let subtaskId of task.subtaskIds) {
            updateTaskData(
                projectId,
                subtaskId,
                {
                    userId: uid,
                    userIds: [uid],
                    currentReviewerId: uid,
                    isPublicFor: isPublicFor,
                    observersIds: newObserversIds,
                    sortIndex,
                    ...sugestedData,
                },
                batch
            )
        }
    }

    if (!externalBatch) {
        await batch.commit()
        return await getTaskData(projectId, taskId)
    }
}

export async function setTaskAssigneeAndObservers(
    projectId,
    taskId,
    uid,
    observers,
    oldAssignee,
    newAssignee,
    task,
    generatedFeeds
) {
    const batch = new BatchWrapper(getDb())

    if (newAssignee.uid !== oldAssignee.uid) {
        await setTaskAssignee(projectId, taskId, uid, oldAssignee, newAssignee, task, generatedFeeds, batch)
    }

    const observersIds = observers.map(user => user.uid)

    const { dueDateByObserversIds, estimationsByObserverIds } = TasksHelper.mergeDueDateAndEstimationsByObserversIds(
        task.dueDateByObserversIds,
        observersIds,
        task.estimationsByObserverIds
    )

    const updateData = { observersIds, dueDateByObserversIds, estimationsByObserverIds }

    updateTaskData(projectId, taskId, updateData, batch)
    for (let subtaskId of task.subtaskIds) {
        updateTaskData(projectId, subtaskId, updateData, batch)
    }

    if (generatedFeeds) {
        await registerTaskObservedFeeds(projectId, { ...task, userId: newAssignee.uid, observersIds }, task, batch)

        const { loggedUser: feedCreator } = store.getState()
        const feedChainFollowersIds = [...observersIds]
        addUniqueInstanceTypeToArray(feedChainFollowersIds, feedCreator.uid)
        addUniqueInstanceTypeToArray(feedChainFollowersIds, newAssignee.uid)
        batch.feedChainFollowersIds = { [taskId]: feedChainFollowersIds }

        // await createTaskObserversChangedFeed(projectId, task, newAssignee, oldAssignee, taskId, batch)
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: taskId,
            followObject: task,
            feedCreator,
        }
        await tryAddFollower(projectId, followTaskData, batch)
        if (feedCreator.uid !== newAssignee.uid && !isWorkstream(newAssignee.uid)) {
            followTaskData.feedCreator = newAssignee
            await tryAddFollower(projectId, followTaskData, batch)
        }
    }

    batch.commit()
}

export async function setTaskAssigneeMultiple(tasks, oldAssignee, newAssignee) {
    const batch = new BatchWrapper(getDb())
    const taskBatch = new BatchWrapper(getDb())

    const promises = []
    for (let task of tasks) {
        if (task.parentId) {
            promises.push(deleteSubTaskFromParent(task.projectId, task.id, task, taskBatch))
        }

        // update "isPublicFor" field
        let isPublicFor = [...task.isPublicFor]
        let tmpIndex = isPublicFor.indexOf(oldAssignee.uid)
        if (tmpIndex >= 0) {
            isPublicFor[tmpIndex] = newAssignee.uid
        } else {
            isPublicFor.push(newAssignee.uid)
        }

        // Determine the sortIndex based on whether it's a calendar task
        let sortIndex
        if (task.calendarData && task.calendarData.start) {
            const { start } = task.calendarData
            sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
        } else {
            sortIndex = generateSortIndex()
        }

        if (task.userIds.length > 1) {
            // The task is in workflow, we need to reset the workflow back to open
            updateTaskData(
                task.projectId,
                task.id,
                {
                    userId: newAssignee.uid,
                    stepHistory: [OPEN_STEP],
                    userIds: [newAssignee.uid],
                    currentReviewerId: newAssignee.uid,
                    parentId: null,
                    isSubtask: false,
                    isPublicFor: isPublicFor,
                    sortIndex,
                },
                taskBatch
            )
        } else {
            updateTaskData(
                task.projectId,
                task.id,
                {
                    userId: newAssignee.uid,
                    userIds: [newAssignee.uid],
                    currentReviewerId: newAssignee.uid,
                    parentId: null,
                    isSubtask: false,
                    isPublicFor: isPublicFor,
                    sortIndex,
                },
                taskBatch
            )
        }

        // change assignee of its subtasks
        if (task.subtaskIds?.length > 0) {
            for (let subtaskId of task.subtaskIds) {
                updateTaskData(
                    task.projectId,
                    subtaskId,
                    {
                        userId: newAssignee.uid,
                        userIds: [newAssignee.uid],
                        currentReviewerId: newAssignee.uid,
                        isPublicFor: isPublicFor,
                        sortIndex,
                    },
                    taskBatch
                )
            }
        }
    }

    await Promise.all(promises)
    taskBatch.commit()

    for (let task of tasks) {
        const { loggedUser: feedCreator } = store.getState()
        const feedChainFollowersIds = [feedCreator.uid]
        addUniqueInstanceTypeToArray(feedChainFollowersIds, newAssignee.uid)
        batch.feedChainFollowersIds = { [task.id]: feedChainFollowersIds }

        await createTaskAssigneeChangedFeed(task.projectId, task, newAssignee, oldAssignee, task.id, batch)
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: task.id,
            followObject: task,
            feedCreator,
        }

        await tryAddFollower(task.projectId, followTaskData, batch)
        if (feedCreator.uid !== newAssignee.uid && !isWorkstream(newAssignee.uid)) {
            followTaskData.feedCreator = newAssignee
            await tryAddFollower(task.projectId, followTaskData, batch)
        }
    }
    batch.commit()
}

export async function setTaskProject(currentProject, newProject, task, oldAssignee, newAssignee) {
    const { loggedUser, projectUsers, route } = store.getState()

    const newProjectUsers = projectUsers[newProject.id]

    const taskCopy = { ...task }

    if (task.suggestedBy) {
        taskCopy.userId = loggedUser.uid
        taskCopy.suggestedBy = null
    }

    taskCopy.stepHistory = [OPEN_STEP]
    taskCopy.userIds = [task.userId]
    taskCopy.currentReviewerId = task.done ? DONE_STEP : task.userId
    taskCopy.observersIds = []
    taskCopy.dueDateByObserversIds = {}
    taskCopy.estimationsByObserverIds = {}
    taskCopy.parentGoalId = null
    taskCopy.parentGoalIsPublicFor = null
    taskCopy.lockKey = ''

    // Preserve the sortIndex for calendar tasks based on their start time
    if (taskCopy.calendarData && taskCopy.calendarData.start) {
        const { start } = taskCopy.calendarData
        taskCopy.sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
    } else {
        taskCopy.sortIndex = generateSortIndex()
    }

    taskCopy.creatorId = newProjectUsers.map(user => user.uid).includes(taskCopy.creatorId)
        ? taskCopy.creatorId
        : loggedUser.uid
    if (task.parentId) {
        taskCopy.parentId = null
        taskCopy.isSubtask = false
        taskCopy.inDone = taskCopy.done
        taskCopy.parentDone = false
        taskCopy.completed = taskCopy.done ? Date.now() : null
    }

    const subtaskIds = taskCopy.subtaskIds
    taskCopy.subtaskIds = []
    taskCopy.subtaskNames = []

    updateEditionData(taskCopy)

    delete taskCopy.time
    delete taskCopy.projectId
    await getDb().doc(`items/${newProject.id}/tasks/${task.id}`).set(taskCopy)

    if (route === 'TaskDetailedView') {
        NavigationService.navigate('TaskDetailedView', {
            task: taskCopy,
            projectId: newProject.id,
        })

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, newProject.id)
        store.dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            switchProject(newProject.index),
            setSelectedTypeOfProject(projectType),
            setSelectedNavItem(DV_TAB_TASK_PROPERTIES),
        ])
    }
    const promises = []
    promises.push(
        createSubtasksCopies(currentProject.id, newProject.id, task.id, taskCopy, subtaskIds, null, false, false)
    )
    promises.push(
        getDb().doc(`items/${currentProject.id}/tasks/${task.id}`).update({ movingToOtherProjectId: newProject.id })
    )
    await Promise.all(promises)

    batch = new BatchWrapper(getDb())
    updateTaskData(currentProject.id, task.id, {}, batch)
    batch.delete(getDb().doc(`items/${currentProject.id}/tasks/${task.id}`))
    batch.commit()

    setTaskProjectFeedsChain(currentProject, newProject, task, oldAssignee, newAssignee)
}

export async function setTaskParentGoal(projectId, taskId, task, goal, externalBatch) {
    const goalId = goal ? goal.id : null
    const parentGoalIsPublicFor = goal ? goal.isPublicFor : null
    const lockKey = goal && goal.lockKey ? goal.lockKey : ''
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    // Determine the sortIndex based on whether it's a calendar task
    let sortIndex
    if (task.calendarData && task.calendarData.start) {
        const { start } = task.calendarData
        sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
    } else {
        sortIndex = generateSortIndex()
    }

    if (task.parentId) {
        await deleteSubTaskFromParent(projectId, taskId, task, batch)
        updateTaskData(
            projectId,
            taskId,
            {
                parentId: null,
                isSubtask: false,
                parentGoalId: goalId,
                parentGoalIsPublicFor,
                lockKey,
                sortIndex,
            },
            batch
        )
    } else {
        updateTaskData(
            projectId,
            taskId,
            {
                parentGoalId: goalId,
                parentGoalIsPublicFor,
                lockKey,
                sortIndex,
            },
            batch
        )
    }

    if (!externalBatch) batch.commit()

    setTaskParentGoalFeedsChain(projectId, taskId, goalId, task.parentGoalId, task)
}

export async function setTaskDueDate(
    projectId,
    taskId,
    dueDate,
    task,
    isObservedTask,
    externalBatch,
    fromSetTaskFocus
) {
    // REMOVE LOGGING HERE
    // console.log(
    //     `[setTaskDueDate] Called. taskId=${taskId}, dueDate=${dueDate}, fromSetTaskFocus=${fromSetTaskFocus}, task.dueDate=${task?.dueDate}, isObservedTask=${isObservedTask}`
    // )
    const { currentUser } = store.getState()
    const currentUserId = currentUser.uid

    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const newSortIndex = generateSortIndex()
    const commonFields = {
        sortIndex: fromSetTaskFocus ? generateSortIndexForTaskInFocusInTime() : newSortIndex,
    }
    // APPLY FIX HERE: Add !fromSetTaskFocus to the condition
    if (!isObservedTask && !fromSetTaskFocus && dueDate > task.dueDate) {
        // REMOVE LOGGING HERE
        // console.log(
        //     `[setTaskDueDate] Incrementing timesPostponed for task ${taskId}. Old dueDate=${task.dueDate}, New dueDate=${dueDate}`
        // )
        commonFields.timesPostponed = firebase.firestore.FieldValue.increment(1)
        logEvent('task_postponed')
        // REMOVE LOGGING HERE (else block)
        // } else {
        //      console.log(
        //         `[setTaskDueDate] NOT incrementing timesPostponed for task ${taskId}. Condition (!isObservedTask && dueDate > task.dueDate) is false. fromSetTaskFocus=${fromSetTaskFocus}`
        //     )
    }
    if (task.parentId) {
        await deleteSubTaskFromParent(projectId, taskId, task, batch)
        updateTaskData(
            projectId,
            taskId,
            {
                parentId: null,
                isSubtask: false,
                dueDate,
                ...commonFields,
            },
            batch
        )
    } else {
        const updateData = isObservedTask ? { [`dueDateByObserversIds.${currentUserId}`]: dueDate } : { dueDate }
        updateTaskData(
            projectId,
            taskId,
            {
                ...updateData,
                ...commonFields,
            },
            batch
        )

        const subtasksUpdate =
            !isObservedTask && dueDate > task.dueDate
                ? { ...updateData, timesPostponed: firebase.firestore.FieldValue.increment(1) }
                : updateData
        updateSubtasksState(projectId, task.subtaskIds, subtasksUpdate, batch)
    }

    const endOfToday = moment().endOf('day').valueOf()
    let shouldFindNewFocusTask = false // Flag to check if we need to find a new focus task
    if (endOfToday < dueDate) {
        const assignee = TasksHelper.getUserInProject(projectId, task.userId)
        // Check if the postponed task was the focus task
        if (assignee && assignee.inFocusTaskId === task.id) {
            // Instead of just removing focus, we'll find a new one after committing the postpone changes
            // We remove the direct call to updateFocusedTask here
            // REMOVE LOGGING HERE
            // console.log(
            //     `[setTaskDueDate] Task ${taskId} being postponed was the focus task. Setting shouldFindNewFocusTask=true.`
            // )
            shouldFindNewFocusTask = true
        }
    }

    if (!externalBatch) await batch.commit()

    // If the postponed task was the focus task, find and set a new one now
    if (shouldFindNewFocusTask) {
        // REMOVE LOGGING HERE
        // console.log(
        //     `[setTaskDueDate] Task ${taskId} was postponed focus task. Calling findAndSetNewFocusedTask for user ${task.userId}.`
        // )
        await findAndSetNewFocusedTask(projectId, task.userId, task.parentGoalId)
    }

    setTaskDueDateFeedsChain(projectId, taskId, dueDate, task, isObservedTask)
}

export async function setTaskToBacklog(projectId, taskId, task, isObservedTask, externalBatch) {
    const { loggedUser, currentUser } = store.getState()
    const currentUserId = currentUser.uid
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    // Determine the sortIndex based on whether it's a calendar task
    let sortIndex
    if (task.calendarData && task.calendarData.start) {
        const { start } = task.calendarData
        sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
    } else {
        sortIndex = generateSortIndex()
    }

    const commonFields = {
        sortIndex,
        timesPostponed: firebase.firestore.FieldValue.increment(1),
    }
    if (task.parentId) {
        await deleteSubTaskFromParent(projectId, taskId, task, batch)
        updateTaskData(
            projectId,
            taskId,
            {
                ...commonFields,
                parentId: null,
                isSubtask: false,
                dueDate: Number.MAX_SAFE_INTEGER,
            },
            batch
        )
    } else {
        const updateData = isObservedTask
            ? { [`dueDateByObserversIds.${currentUserId}`]: Number.MAX_SAFE_INTEGER }
            : { dueDate: Number.MAX_SAFE_INTEGER }

        updateTaskData(
            projectId,
            taskId,
            {
                ...commonFields,
                ...updateData,
            },
            batch
        )

        const subtasksUpdate = { ...updateData, timesPostponed: firebase.firestore.FieldValue.increment(1) }
        updateSubtasksState(projectId, task.subtaskIds, subtasksUpdate, batch)
    }
    if (!externalBatch) await batch.commit()
    setTaskToBacklogFeedsChain(projectId, taskId, task, isObservedTask)
}

export async function setTaskShared(projectId, taskId, shared) {
    updateTaskData(projectId, taskId, { shared: shared }, null)
}

export async function stopObservingTask(
    projectId,
    task,
    userIdStopingObserving,
    comment,
    assigneeEstimation,
    workflow,
    selectedNextStepIndex,
    checkBoxId
) {
    store.dispatch(startLoadingData())
    const { loggedUser } = store.getState()
    const ownerIsWorkstream = task?.userId?.startsWith(WORKSTREAM_ID_PREFIX)

    const taskIsMovedInWorkflow = selectedNextStepIndex !== null

    if (taskIsMovedInWorkflow && ownerIsWorkstream) {
        const taskOwner = TasksHelper.getTaskOwner(task.userId, projectId)
        await setTaskAssignee(projectId, task.id, loggedUser.uid, taskOwner, loggedUser, { ...task }, false)
    }

    if (taskIsMovedInWorkflow) {
        const { stepHistory } = task
        const stepsIds = getWorkflowStepsIdsSorted(workflow)
        const stepToMoveId = getWorkflowStepId(selectedNextStepIndex, stepsIds)
        const commentType =
            comment && comment.length > 0
                ? getCommentDirectionWhenMoveTaskInTheWorklfow(selectedNextStepIndex, stepsIds, stepHistory)
                : STAYWARD_COMMENT
        const estimations = { ...task.estimations, [OPEN_STEP]: assigneeEstimation }

        if (task.userIds.length === 1) {
            const taskToProcess = ownerIsWorkstream
                ? { ...task, userId: loggedUser.uid, userIds: [loggedUser.uid], currentReviewerId: loggedUser.uid }
                : task
            moveTasksFromOpen(projectId, taskToProcess, stepToMoveId, comment, commentType, estimations, checkBoxId)
        } else {
            moveTasksFromMiddleOfWorkflow(projectId, task, stepToMoveId, comment, commentType, estimations, checkBoxId)
        }
    }

    const updateData = {}

    const updateEstimation = !taskIsMovedInWorkflow && assigneeEstimation !== task.estimations[OPEN_STEP]
    if (updateEstimation) {
        updateData[`estimations.${OPEN_STEP}`] = assigneeEstimation
    }

    if (userIdStopingObserving) {
        updateData.observersIds = firebase.firestore.FieldValue.arrayRemove(userIdStopingObserving)
        updateData[`dueDateByObserversIds.${userIdStopingObserving}`] = firebase.firestore.FieldValue.delete()
        updateData[`estimationsByObserverIds.${userIdStopingObserving}`] = firebase.firestore.FieldValue.delete()
    }

    const batch = new BatchWrapper(getDb())
    updateTaskData(projectId, task.id, { ...updateData }, batch)
    updateSubtasksState(projectId, task.subtaskIds, updateData, batch)
    batch.commit()

    store.dispatch(stopLoadingData())

    if (!taskIsMovedInWorkflow && comment) {
        updateNewAttachmentsData(projectId, comment).then(commentWithAttachments => {
            createObjectMessage(projectId, task.id, commentWithAttachments, 'tasks', STAYWARD_COMMENT, null, null)
        })
    }

    feedsChainInStopObservingTask(projectId, task, userIdStopingObserving, assigneeEstimation, updateEstimation)
}

export async function moveTasksFromMiddleOfWorkflow(
    projectId,
    task,
    stepToMoveId,
    comment,
    commentType,
    estimations,
    checkBoxId
) {
    const { loggedUser } = store.getState()
    const { parentId, subtaskIds, userId, stepHistory, userIds } = task

    if (comment) createObjectMessage(projectId, task.id, comment, 'tasks', commentType, null, null)

    let updateData
    let workflow
    let forwardDirection

    if (stepToMoveId === OPEN_STEP) {
        forwardDirection = false
        updateData = {
            userIds: [userId],
            stepHistory: [OPEN_STEP],
            currentReviewerId: userId,
            completed: null,
            dueDate: Date.now(),
            completedTime: null,
        }
    } else if (stepToMoveId === DONE_STEP) {
        forwardDirection = true
        updateData = {
            currentReviewerId: DONE_STEP,
            completed: Date.now(),
        }
    } else {
        workflow = getUserWorkflow(projectId, userId)
        const workflowStepsIds = Object.keys(workflow).sort(chronoKeysOrder)
        const stepToMoveIndex = workflowStepsIds.indexOf(stepToMoveId)
        const currentStepId = stepHistory[stepHistory.length - 1]
        const currentStepIndex = workflowStepsIds.indexOf(currentStepId)
        forwardDirection = stepToMoveIndex > currentStepIndex

        if (forwardDirection) {
            const { reviewerUid } = workflow[stepToMoveId]
            updateData = {
                userIds: [...userIds, reviewerUid],
                currentReviewerId: reviewerUid,
                completed: Date.now(),
                stepHistory: [...stepHistory, stepToMoveId],
                dueDate: Date.now(),
            }
        } else {
            const newUserIds = [task.userId]
            const newStepHistory = [OPEN_STEP]
            let newCurrentReviewerId = task.userId

            for (let i = 0; i < workflowStepsIds.length; i++) {
                const stepId = workflowStepsIds[i]
                const { reviewerUid } = workflow[stepId]
                if (stepId === stepToMoveId) {
                    newStepHistory.push(stepId)
                    newUserIds.push(reviewerUid)
                    newCurrentReviewerId = reviewerUid
                    break
                } else if (stepHistory.includes(stepId)) {
                    newStepHistory.push(stepId)
                    newUserIds.push(reviewerUid)
                }
            }

            updateData = {
                userIds: newUserIds,
                stepHistory: newStepHistory,
                currentReviewerId: newCurrentReviewerId,
                completed: Date.now(),
            }
        }
    }

    if (!task.parentId && forwardDirection) {
        const reviewerId = userIds[userIds.length - 1]
        earnGold(projectId, reviewerId, MAX_GOLD_TO_EARN_BY_CHECK_TASKS, checkBoxId)
    }

    const batch = new BatchWrapper(getDb())

    if (stepToMoveId === DONE_STEP) {
        const taskEstimation = estimations[OPEN_STEP] ? estimations[OPEN_STEP] : 0
        if (!task.parentId) {
            updateXpByDoneTask(userId, taskEstimation, firebase, getDb(), projectId)
            if (workflow) updateXpByDoneForAllReviewers(estimations, workflow, firebase, getDb(), projectId)
        }
        updateStatistics(projectId, userId, taskEstimation, false, false, null, batch)

        logDoneTasks(task.userId, loggedUser.uid, true)
    }

    // Preserve the sortIndex for calendar tasks based on their start time
    let sortIndex
    if (task.calendarData && task.calendarData.start) {
        const { start } = task.calendarData
        sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
    } else {
        sortIndex = generateSortIndex()
    }

    updateTaskData(
        projectId,
        task.id,
        {
            ...updateData,
            done: stepToMoveId === DONE_STEP,
            inDone: stepToMoveId === DONE_STEP,
            sortIndex,
            estimations,
        },
        batch
    )

    parentId
        ? await promoteSubtaskToTask(projectId, task, batch)
        : updateSubtasksState(
              projectId,
              subtaskIds,
              { ...updateData, parentDone: stepToMoveId === DONE_STEP, inDone: stepToMoveId === DONE_STEP },
              batch
          )

    batch.commit()

    const assignee = TasksHelper.getUserInProject(projectId, task.userId)
    if (assignee && assignee.inFocusTaskId === task.id) {
        if (stepToMoveId === DONE_STEP) {
            await findAndSetNewFocusedTask(projectId, task.userId, task.parentGoalId)
        } else {
            await updateFocusedTask(task.userId, projectId, null, null, null)
        }
    }

    moveTasksinWorkflowFeedsChain(projectId, task, stepToMoveId, workflow, estimations)
}

const getTaskCompletedTime = task => {
    const { loggedUserProjectsMap, loggedUser } = store.getState()
    const {
        uid: loggedUserId,
        activeTaskId,
        activeTaskProjectId,
        activeTaskStartingDate,
        firstLoginDateInDay,
    } = loggedUser
    const { id: taskId, userId, estimations, calendarData, autoEstimation } = task

    if (calendarData) {
        const endTimeForAllDayCalendarTasks = moment(firstLoginDateInDay).add(8, 'hours').valueOf()
        const { startDateTimestamp, endDateTimestamp } = getCalendarTaskStartAndEndTimestamp(
            calendarData,
            firstLoginDateInDay,
            endTimeForAllDayCalendarTasks
        )
        return { startTime: moment(startDateTimestamp).valueOf(), endTime: moment(endDateTimestamp).valueOf() }
    } else {
        const estimation = estimations[OPEN_STEP] || 0
        const canExtendEstimation = getTaskAutoEstimation(
            activeTaskProjectId,
            estimation,
            autoEstimation,
            loggedUserProjectsMap
        )

        const currentTime = moment().valueOf()
        const baseStartTime =
            loggedUserId !== userId || activeTaskId !== taskId || !canExtendEstimation
                ? currentTime
                : activeTaskStartingDate

        const { startDate, endDate } = getRoundedStartAndEndDates(baseStartTime, estimation)

        return { startTime: startDate.valueOf(), endTime: endDate.valueOf() }
    }
}

export async function moveTasksFromOpen(projectId, task, stepToMoveId, comment, commentType, estimations, checkBoxId) {
    const { loggedUser } = store.getState()
    const loggedUserId = loggedUser.uid
    const { parentId, subtaskIds, userId } = task

    if (comment) createObjectMessage(projectId, task.id, comment, 'tasks', commentType, null, null)

    const ownerIsWorkstream = userId.startsWith(WORKSTREAM_ID_PREFIX)
    const newUserId = ownerIsWorkstream ? loggedUserId : userId

    let updateData
    let workflow = getUserWorkflow(projectId, newUserId)

    const completedTime = getTaskCompletedTime(task)

    if (stepToMoveId === DONE_STEP) {
        updateData = {
            userId: newUserId,
            userIds: [newUserId],
            currentReviewerId: DONE_STEP,
            completed: Date.now(),
            completedTime,
        }
    } else {
        const { reviewerUid } = workflow[stepToMoveId]
        updateData = {
            userId: newUserId,
            userIds: [newUserId, reviewerUid],
            currentReviewerId: reviewerUid,
            completed: Date.now(),
            stepHistory: [OPEN_STEP, stepToMoveId],
            completedTime,
        }
    }

    createRecurrentTask(projectId, task.id)

    const ownerIsTeamMeber = !!TasksHelper.getUserInProject(projectId, task.userId)

    if (!task.parentId && ownerIsTeamMeber) earnGold(projectId, newUserId, MAX_GOLD_TO_EARN_BY_CHECK_TASKS, checkBoxId)

    const batch = new BatchWrapper(getDb())

    if (stepToMoveId === DONE_STEP) {
        if (ownerIsTeamMeber) {
            const taskEstimation = estimations[OPEN_STEP] ? estimations[OPEN_STEP] : 0
            if (!task.parentId) {
                updateXpByDoneTask(newUserId, taskEstimation, firebase, getDb(), projectId)
                if (workflow) updateXpByDoneForAllReviewers(estimations, workflow, firebase, getDb(), projectId)
            }
            updateStatistics(projectId, newUserId, taskEstimation, false, false, null, batch)
        }

        logDoneTasks(task.userId, loggedUser.uid, workflow ? true : false)
    }

    if (ownerIsWorkstream) {
        const wormstream = getWorkstreamInProject(projectId, userId)
        setTaskAssignee(projectId, task.id, loggedUserId, wormstream, loggedUser, task, false, null)
    }

    // Preserve the sortIndex for calendar tasks based on their start time
    let sortIndex
    if (task.calendarData && task.calendarData.start) {
        const { start } = task.calendarData
        sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
    } else {
        sortIndex = generateSortIndex()
    }

    updateTaskData(
        projectId,
        task.id,
        {
            ...updateData,
            done: stepToMoveId === DONE_STEP,
            inDone: stepToMoveId === DONE_STEP,
            sortIndex,
            estimations,
        },
        batch
    )

    parentId
        ? await promoteSubtaskToTask(projectId, task, batch)
        : updateSubtasksState(
              projectId,
              subtaskIds,
              { ...updateData, parentDone: stepToMoveId === DONE_STEP, inDone: stepToMoveId === DONE_STEP },
              batch
          )

    batch.commit().then(() => {
        moveToTomorrowGoalReminderDateIfThereAreNotMoreTasks(projectId, task)
    })

    const assignee = TasksHelper.getUserInProject(projectId, task.userId)

    // Debug logging for focus task selection
    console.log(`[moveTasksFromOpen] Focus task debug:`, {
        taskId: task.id,
        originalTaskUserId: task.userId,
        newUserId,
        stepToMoveId,
        assignee: assignee
            ? {
                  uid: assignee.uid,
                  inFocusTaskId: assignee.inFocusTaskId,
              }
            : null,
        taskUserIds: task.userIds,
        isWorkflow: task.userIds.length > 1,
        focusTaskMatches: assignee?.inFocusTaskId === task.id,
    })

    if (assignee && assignee.inFocusTaskId === task.id) {
        // When a user completes their part of a task (either to DONE_STEP or workflow step),
        // they should get a new focus task since they're done with the current one
        console.log(`[moveTasksFromOpen] User completed their part of task - calling findAndSetNewFocusedTask`)
        await findAndSetNewFocusedTask(projectId, task.userId, task.parentGoalId)
    } else {
        console.log(`[moveTasksFromOpen] NOT calling focus task functions - conditions not met`)
    }

    moveTasksinWorkflowFeedsChain(projectId, task, stepToMoveId, workflow, estimations)
}

export async function moveTasksFromDone(projectId, task, stepToMoveId) {
    const { stepHistory, parentId, subtaskIds, userId, estimations } = task

    let workflow
    let updateData

    if (stepToMoveId === OPEN_STEP) {
        updateData = {
            userIds: [task.userId],
            stepHistory: [OPEN_STEP],
            currentReviewerId: task.userId,
            completed: null,
            dueDate: Date.now(),
            completedTime: null,
        }
    } else {
        workflow = getUserWorkflow(projectId, task.userId)
        const workflowStepsIds = Object.keys(workflow).sort(chronoKeysOrder)

        const newUserIds = [task.userId]
        const newStepHistory = [OPEN_STEP]
        let newCurrentReviewerId = task.userId

        for (let i = 0; i < workflowStepsIds.length; i++) {
            const stepId = workflowStepsIds[i]
            const { reviewerUid } = workflow[stepId]
            if (stepId === stepToMoveId) {
                newStepHistory.push(stepId)
                newUserIds.push(reviewerUid)
                newCurrentReviewerId = reviewerUid
                break
            } else if (stepHistory.includes(stepId)) {
                newStepHistory.push(stepId)
                newUserIds.push(reviewerUid)
            }
        }

        updateData = {
            userIds: newUserIds,
            stepHistory: newStepHistory,
            currentReviewerId: newCurrentReviewerId,
            completed: Date.now(),
            dueDate: Date.now(),
        }
    }

    const batch = new BatchWrapper(getDb())

    const ownerIsTeamMeber = !!TasksHelper.getUserInProject(projectId, task.userId)

    if (ownerIsTeamMeber) {
        updateStatistics(projectId, userId, estimations[OPEN_STEP], true, false, task.completed, batch)
    }

    // Preserve the sortIndex for calendar tasks based on their start time
    let sortIndex
    if (task.calendarData && task.calendarData.start) {
        const { start } = task.calendarData
        sortIndex = start.dateTime ? moment(start.dateTime).valueOf() : moment(start.date).valueOf()
    } else {
        sortIndex = generateSortIndex()
    }

    updateTaskData(
        projectId,
        task.id,
        {
            ...updateData,
            done: false,
            inDone: false,
            sortIndex,
        },
        batch
    )

    parentId
        ? await promoteSubtaskToTask(projectId, task, batch)
        : updateSubtasksState(projectId, subtaskIds, { ...updateData, parentDone: false, inDone: false }, batch)

    batch.commit()

    moveTasksinWorkflowFeedsChain(projectId, task, stepToMoveId, workflow, task.estimations)
}

export async function setTaskStatus(
    projectId,
    taskId,
    isDone,
    taskOwnerUid,
    task,
    comment,
    createDoneFeed,
    oldEstimation,
    newEstimation
) {
    const taskBatch = new BatchWrapper(getDb())
    const completed = isDone ? Date.now() : firebase.firestore.FieldValue.delete()

    const updateData = {
        done: isDone,
        inDone: task.parentId ? task.inDone : isDone,
        recurrence: task.recurrence,
    }

    if (!task.parentId) {
        updateData.completed = completed
        updateData.sortIndex = task.done && !isDone ? generateSortIndex() : task.sortIndex
        updateData.currentReviewerId = isDone ? DONE_STEP : task.userId
    }

    updateTaskData(projectId, taskId, updateData, taskBatch)

    if (isDone) {
        updateSubtasksCompletedState(projectId, task.subtaskIds, completed, taskBatch)
    }

    if (task.done && !isDone) {
        updateSubtasksState(
            projectId,
            task.subtaskIds,
            {
                parentDone: false,
                currentReviewerId: task.userId,
                inDone: false,
            },
            taskBatch
        )
    }
    if (!task.done && isDone) {
        updateSubtasksState(
            projectId,
            task.subtaskIds,
            {
                parentDone: true,
                currentReviewerId: DONE_STEP,
                inDone: true,
            },
            taskBatch
        )
    }

    const taskRealOwner = TasksHelper.getTaskOwner(taskOwnerUid, projectId)
    const statisticUserUid = taskRealOwner.recorderUserId ? store.getState().loggedUser.uid : taskOwnerUid

    if (isDone) {
        updateStatistics(projectId, statisticUserUid, task.estimations[OPEN_STEP], false, false, null, taskBatch)
    } else {
        updateStatistics(
            projectId,
            statisticUserUid,
            task.estimations[OPEN_STEP],
            true,
            false,
            task.completed,
            taskBatch
        )
    }

    taskBatch.commit()

    const assignee = TasksHelper.getUserInProject(projectId, taskOwnerUid)

    // Debug logging for focus task selection
    console.log(`[setTaskStatus] Focus task debug:`, {
        taskId,
        taskOwnerUid,
        isDone,
        assignee: assignee
            ? {
                  uid: assignee.uid,
                  inFocusTaskId: assignee.inFocusTaskId,
              }
            : null,
        taskUserIds: task.userIds,
        isWorkflow: task.userIds.length > 1,
        focusTaskMatches: assignee?.inFocusTaskId === taskId,
    })

    if (assignee && assignee.inFocusTaskId === taskId && isDone) {
        console.log(`[setTaskStatus] Calling findAndSetNewFocusedTask for workflow task`)
        await findAndSetNewFocusedTask(projectId, taskOwnerUid, task.parentGoalId)
    } else if (isDone) {
        console.log(`[setTaskStatus] NOT calling findAndSetNewFocusedTask - conditions not met`)
    }

    const feedBatch = new BatchWrapper(getDb())
    if (comment) {
        createObjectMessage(projectId, taskId, comment, 'tasks', STAYWARD_COMMENT, null, null)
    }

    if (isDone) {
        if (!task.parentId) {
            updateXpByDoneTask(statisticUserUid, task.estimations[OPEN_STEP], firebase, getDb(), projectId)
        }

        if (task.userIds.length === 1) {
            createRecurrentTask(projectId, task.id)
        }
        logEvent('done_task', {
            taskOwnerUid: task.userId,
            effectingUserUid: store.getState().loggedUser.uid,
            isInWorkflow: task.userIds.length > 1,
        })
        if (createDoneFeed) {
            if (oldEstimation !== newEstimation) {
                await createTaskAssigneeEstimationChangedFeed(
                    projectId,
                    task.id,
                    oldEstimation,
                    newEstimation,
                    feedBatch
                )
            }

            updateSubtasksState(projectId, task.subtaskIds, {
                parentDone: true,
                currentReviewerId: DONE_STEP,
                inDone: true,
            })

            await createTaskCheckedDoneFeed(projectId, task, taskId, feedBatch)

            const followTaskData = {
                followObjectsType: FOLLOWER_TASKS_TYPE,
                followObjectId: taskId,
                followObject: task,
                feedCreator: store.getState().loggedUser,
            }
            await tryAddFollower(projectId, followTaskData, feedBatch)
        }
    } else {
        await createTaskUncheckedDoneFeed(projectId, task, taskId, feedBatch)
    }
    feedBatch.commit()
}

export const updateSubtasksCompletedState = (projectId, subtaskIds, completed, externalBatch) => {
    if (subtaskIds && subtaskIds.length > 0) {
        const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
        subtaskIds.forEach(subtaskId => {
            updateTaskData(projectId, subtaskId, { completed }, batch)
        })
        if (!externalBatch) {
            batch.commit()
        }
    }
}

export const promoteSubtask = async (projectId, task) => {
    const { loggedUser } = store.getState()
    const taskId = task.id
    const promotedTask = { ...task, parentId: null, isSubtask: false }
    const batch = new BatchWrapper(getDb())
    await promoteSubtaskToTask(projectId, task, batch)
    await createSubtaskPromotedFeed(projectId, promotedTask, taskId, task.parentId, batch)
    const followTaskData = {
        followObjectsType: 'tasks',
        followObjectId: taskId,
        followObject: promotedTask,
        feedCreator: loggedUser,
    }
    await tryAddFollower(projectId, followTaskData, batch)
    batch.commit()
}

async function promoteSubtaskToTask(projectId, task, externalBatch) {
    const taskId = task.id
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    await deleteSubTaskFromParent(projectId, taskId, task, batch)
    const updateData = {
        parentDone: false,
        parentId: null,
        isSubtask: false,
        sortIndex: generateSortIndex(),
        inDone: false,
    }

    if (task.parentDone) {
        if (!task.done) {
            updateData.completed = null
            updateData.currentReviewerId = task.userId
            updateData.stepHistory = [OPEN_STEP]
            updateData.userIds = [task.userId]
            updateData.done = false
            updateData.inDone = false
        }
    } else if (task.done) {
        updateData.done = false
        updateData.inDone = false
    }

    updateTaskData(projectId, taskId, updateData, batch)
    if (!externalBatch) {
        batch.commit()
    }
}

export const updateSuggestedTask = (projectId, taskId, object) => {
    updateTaskData(projectId, taskId, object, null)
}

export const nextStepSuggestedTask = (projectId, targetStepId, task, estimations, comment, checkBoxId) => {
    const { subtaskIds } = task
    const updateData = { suggestedBy: null }
    updateTaskData(projectId, task.id, updateData, null)
    updateSubtasksState(projectId, subtaskIds, updateData, null)
    moveTasksFromOpen(projectId, task, targetStepId, comment, FORDWARD_COMMENT, estimations, checkBoxId)
}

export const updateSubtasksState = (projectId, subtaskIds, updateData, externalBatch) => {
    if (subtaskIds && subtaskIds.length > 0) {
        const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
        subtaskIds.forEach(subtaskId => {
            updateTaskData(projectId, subtaskId, updateData, batch)
        })
        if (!externalBatch) {
            batch.commit()
        }
    }
}

export const getDateToMoveTaskInAutoTeminder = (timesPostponed, isObservedTask) => {
    let date = moment()

    if (!timesPostponed || isObservedTask) {
        date.add(1, 'day')
    } else if (timesPostponed === 1) {
        date.add(2, 'day')
    } else if (timesPostponed === 2) {
        date.add(4, 'day')
    } else if (timesPostponed === 3) {
        date.add(8, 'day')
    } else if (timesPostponed === 4) {
        date.add(16, 'day')
    } else if (timesPostponed === 5) {
        date.add(32, 'day')
    } else if (timesPostponed === 6) {
        date.add(64, 'day')
    } else if (timesPostponed === 7) {
        date.add(128, 'day')
    } else if (timesPostponed === 8) {
        date.add(256, 'day')
    } else {
        date = BACKLOG_DATE_NUMERIC
    }
    return date
}

export async function autoReminderMultipleTasks(tasks) {
    store.dispatch(startLoadingData())

    const sortedTasks = [...tasks].sort((a, b) => a.sortIndex - b.sortIndex)
    const batch = new BatchWrapper(getDb())
    const promises = []
    for (let task of sortedTasks) {
        const dueDate = getDateToMoveTaskInAutoTeminder(task.timesPostponed, task.isObservedTask)
        const dateTimestamp = dueDate === BACKLOG_DATE_NUMERIC ? BACKLOG_DATE_NUMERIC : dueDate.valueOf()
        promises.push(setTaskDueDate(task.projectId, task.id, dateTimestamp, task, task.isObservedTask, batch))
    }
    await Promise.all(promises)
    await batch.commit()

    store.dispatch([setSelectedTasks(null, true), stopLoadingData()])
}

async function findAndSetNewFocusedTask(currentProjectId, userId, previousTaskParentGoalId = null) {
    console.log(
        `[findAndSetNewFocusedTask] Starting search for userId: ${userId}, projectId: ${currentProjectId}, previousTaskParentGoalId: ${previousTaskParentGoalId}`
    )

    const currentTime = moment()
    const fifteenMinutesFromNow = moment().add(15, 'minutes')
    let earliestUpcomingCalendarTask = null
    let earliestUpcomingCalendarTaskProject = null
    let earliestStartTime = moment().add(16, 'minutes') // Initialize to be later than any valid upcoming task

    // Declare Redux state variables once at a higher scope
    const { projectUsers, loggedUserProjects, loggedUser } = store.getState() // Added loggedUser here

    // --- NEW PRE-PRIORITIZATION: Check for upcoming calendar tasks across ALL projects ---
    const allUserProjectIds = Object.keys(projectUsers)
        .filter(pid => projectUsers[pid]?.some(member => member.uid === userId)) // Projects user is a member of
        .map(pid => loggedUserProjects.find(p => p.id === pid))
        .filter(project => project) // Ensure project exists
        .map(p => p.id)

    for (const pid of allUserProjectIds) {
        const tasksCollectionRef = getDb().collection(`items/${pid}/tasks`)
        let calendarQuery = tasksCollectionRef
            .where('userId', '==', userId)
            .where('done', '==', false)
            .where('inDone', '==', false)
            .where('isSubtask', '==', false)
            .where('sortIndex', '>=', currentTime.valueOf())
            .where('sortIndex', '<', fifteenMinutesFromNow.valueOf())
            .orderBy('sortIndex', 'asc')

        const snapshot = await calendarQuery.get()

        if (!snapshot.empty) {
            for (const doc of snapshot.docs) {
                const task = { id: doc.id, ...doc.data() }
                // Verify it IS a calendar task and its explicit start time is within the window
                if (task.calendarData && task.calendarData.start) {
                    const taskStartTimeString = task.calendarData.start.dateTime || task.calendarData.start.date
                    const taskStartTime = moment(taskStartTimeString)

                    if (
                        taskStartTime.isBetween(currentTime, fifteenMinutesFromNow, undefined, '[)') &&
                        taskStartTime.isBefore(earliestStartTime)
                    ) {
                        earliestUpcomingCalendarTask = task
                        earliestUpcomingCalendarTaskProject = pid
                        earliestStartTime = taskStartTime
                    }
                }
            }
        }
    }

    if (earliestUpcomingCalendarTask) {
        console.log(`[findAndSetNewFocusedTask] Found upcoming calendar task:`, {
            projectId: earliestUpcomingCalendarTaskProject,
            taskId: earliestUpcomingCalendarTask.id,
            taskName: earliestUpcomingCalendarTask.name,
        })
        await setNewFocusedTaskBatch(earliestUpcomingCalendarTaskProject, userId, earliestUpcomingCalendarTask)
        return true
    }

    // --- If no upcoming calendar task, proceed with existing group-based prioritization logic ---
    const endOfToday = moment().endOf('day').valueOf() // endOfToday is still needed for non-calendar task logic below
    let newFocusedTask = null

    // --- Phase 1, 2 & 3: Try to find a task in the current project, prioritizing same group ---
    const tasksRef = getDb().collection(`items/${currentProjectId}/tasks`)
    let query = tasksRef
        .where('userId', '==', userId)
        .where('done', '==', false)
        .where('inDone', '==', false)
        .where('isSubtask', '==', false)
        // dueDate and calendarData will be filtered in memory after fetching
        .orderBy('sortIndex', 'desc') // Primary sort

    const openTasksSnapshot = await query.limit(200).get() // Fetch a larger batch for in-memory filtering

    if (!openTasksSnapshot.empty) {
        const allFetchedTasksInCurrentProject = openTasksSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(task => task.dueDate <= endOfToday && !task.calendarData) // Common filter applied once

        // Attempt 1: Tasks with the same parentGoalId as the previous task (if previous had a specific one)
        if (previousTaskParentGoalId !== null && previousTaskParentGoalId !== undefined) {
            const tasksInSameSpecificGroup = allFetchedTasksInCurrentProject.filter(
                task => task.parentGoalId === previousTaskParentGoalId
            )

            // Prioritize non-workflow tasks first
            const nonWorkflowTasksInGroup = tasksInSameSpecificGroup.filter(task => task.userIds.length === 1)
            if (nonWorkflowTasksInGroup.length > 0) {
                newFocusedTask = nonWorkflowTasksInGroup[0] // Already sorted by sortIndex
            } else if (tasksInSameSpecificGroup.length > 0) {
                // Fallback to workflow tasks if no regular tasks available
                newFocusedTask = tasksInSameSpecificGroup[0] // Already sorted by sortIndex
            }
        }

        // Attempt 2: General tasks (parentGoalId is null/undefined)
        // This is tried if:
        //   a) No task was found in Attempt 1 (newFocusedTask is still null) AND
        //      (previousTaskParentGoalId was null/undefined OR previousTaskParentGoalId was specific but group exhausted)
        if (!newFocusedTask) {
            const generalTasks = allFetchedTasksInCurrentProject.filter(
                task => task.parentGoalId === null || task.parentGoalId === undefined
            )

            // Prioritize non-workflow tasks first
            const nonWorkflowGeneralTasks = generalTasks.filter(task => task.userIds.length === 1)
            if (nonWorkflowGeneralTasks.length > 0) {
                newFocusedTask = nonWorkflowGeneralTasks[0] // Already sorted by sortIndex
            } else if (generalTasks.length > 0) {
                // Fallback to workflow tasks if no regular tasks available
                newFocusedTask = generalTasks[0] // Already sorted by sortIndex
            }
        }

        // Attempt 3: Any other task in the current project (general fallback if specific and general group searches yielded nothing)
        if (!newFocusedTask && allFetchedTasksInCurrentProject.length > 0) {
            // Prioritize non-workflow tasks first
            const nonWorkflowTasks = allFetchedTasksInCurrentProject.filter(task => task.userIds.length === 1)
            if (nonWorkflowTasks.length > 0) {
                newFocusedTask = nonWorkflowTasks[0] // Already sorted by sortIndex
            } else {
                // Fallback to workflow tasks if no regular tasks available
                newFocusedTask = allFetchedTasksInCurrentProject[0] // Fallback to the best one by sortIndex from all valid tasks
            }
        }
    }

    if (newFocusedTask) {
        console.log(`[findAndSetNewFocusedTask] Found new focus task in current project:`, {
            taskId: newFocusedTask.id,
            taskName: newFocusedTask.name,
        })
        await setNewFocusedTaskBatch(currentProjectId, userId, newFocusedTask)
        return true
    }

    // --- Phase 4: If no tasks found in current project with prioritization, look in other projects (original logic) ---
    // const { projectUsers, loggedUserProjects } = store.getState(); // This line will be removed as it's declared above
    const userProjects = Object.keys(projectUsers)
        .filter(pid => pid !== currentProjectId) // Exclude current project
        .filter(pid => {
            const projectMembers = projectUsers[pid] || []
            return projectMembers.some(member => member.uid === userId)
        })

    // Sort projects by sortIndexByUser (descending)
    const sortedProjects = userProjects
        .map(pid => loggedUserProjects.find(p => p.id === pid))
        .filter(project => project) // Remove any undefined projects
        .sort((a, b) => {
            const aIndex = a.sortIndexByUser?.[userId] || 0
            const bIndex = b.sortIndexByUser?.[userId] || 0
            return bIndex - aIndex // Sort descending
        })
        .map(p => p.id)

    // Search through each project in order of sortIndexByUser
    for (const pid of sortedProjects) {
        const otherProjectTasksRef = getDb().collection(`items/${pid}/tasks`)
        const otherProjectTasks = await otherProjectTasksRef
            .where('userId', '==', userId)
            .where('done', '==', false)
            .where('inDone', '==', false)
            .where('isSubtask', '==', false)
            .orderBy('sortIndex', 'desc')
            .limit(100) // Fetch a few tasks to ensure we have some valid ones after filtering
            .get()

        if (!otherProjectTasks.empty) {
            // Filter in memory for tasks that meet our criteria
            const validTasks = otherProjectTasks.docs
                .map(doc => ({ id: doc.id, ...doc.data() }))
                .filter(
                    task => task.dueDate <= endOfToday && !task.calendarData // Only tasks due today or earlier // Exclude calendar tasks
                )

            if (validTasks.length > 0) {
                // Prioritize non-workflow tasks first
                const nonWorkflowValidTasks = validTasks.filter(task => task.userIds.length === 1)
                const newFocusedTaskFromOtherProject =
                    nonWorkflowValidTasks.length > 0 ? nonWorkflowValidTasks[0] : validTasks[0] // Fallback to workflow tasks if no regular tasks available

                console.log(`[findAndSetNewFocusedTask] Found new focus task in other project:`, {
                    projectId: pid,
                    taskId: newFocusedTaskFromOtherProject.id,
                    taskName: newFocusedTaskFromOtherProject.name,
                    isWorkflowTask: newFocusedTaskFromOtherProject.userIds.length > 1,
                })
                await setNewFocusedTaskBatch(pid, userId, newFocusedTaskFromOtherProject)
                return true
            }
        }
    }

    // If no tasks found in any project, clear the focus
    const batch = new BatchWrapper(getDb())

    // If a task was previously in focus, its sortIndex needs to be reset appropriately
    if (loggedUser.inFocusTaskId && loggedUser.inFocusTaskProjectId) {
        const previouslyFocusedTaskRef = getDb().doc(
            `items/${loggedUser.inFocusTaskProjectId}/tasks/${loggedUser.inFocusTaskId}`
        )
        try {
            // This read is outside the batch write, which is fine for a get.
            const taskSnap = await previouslyFocusedTaskRef.get()
            if (taskSnap.exists) {
                const taskData = taskSnap.data()
                let newSortIndexForOldFocused
                if (taskData.calendarData && taskData.calendarData.start) {
                    const calStartTimeString = taskData.calendarData.start.dateTime || taskData.calendarData.start.date
                    newSortIndexForOldFocused = moment(calStartTimeString).valueOf()
                } else {
                    newSortIndexForOldFocused = generateSortIndex()
                }
                batch.update(previouslyFocusedTaskRef, { sortIndex: newSortIndexForOldFocused })
            }
        } catch (error) {
            console.error('Error fetching/updating sortIndex for previously focused task during clear focus:', error)
            // Continue without rethrowing, as clearing user focus is primary.
        }
    }

    batch.update(getDb().doc(`users/${userId}`), {
        inFocusTaskId: '',
        inFocusTaskProjectId: '',
    })
    await batch.commit()
    console.log(`[findAndSetNewFocusedTask] No new focus task found - clearing focus`)
    return false
}

// Helper function to set a new focused task with all necessary updates
async function setNewFocusedTaskBatch(projectId, userId, task) {
    const batch = new BatchWrapper(getDb())

    // Set the new task as focused
    await setTaskDueDate(projectId, task.id, moment().valueOf(), task, false, batch, true)
    batch.update(getDb().doc(`items/${projectId}/tasks/${task.id}`), {
        sortIndex: generateSortIndexForTaskInFocusInTime(),
    })

    // Update user's focused task
    batch.update(getDb().doc(`users/${userId}`), {
        inFocusTaskId: task.id,
        inFocusTaskProjectId: projectId,
    })

    // Commit all changes in one batch
    await batch.commit()

    // Create feed after successful update
    createTaskFocusChangedFeed(projectId, task.id, true, null, TasksHelper.getUserInProject(projectId, userId))
}

export async function setTaskAIModel(projectId, taskId, aiModel, task) {
    const batch = new BatchWrapper(getDb())
    updateTaskData(projectId, taskId, { aiModel }, batch)
    if (!task.isSubtask) {
        updateSubtasksState(projectId, task.subtaskIds, { aiModel }, batch)
    }
    batch.commit()
}

export async function setTaskAITemperature(projectId, taskId, aiTemperature, task) {
    const batch = new BatchWrapper(getDb())
    updateTaskData(projectId, taskId, { aiTemperature }, batch)
    if (!task.isSubtask) {
        updateSubtasksState(projectId, task.subtaskIds, { aiTemperature }, batch)
    }
    batch.commit()
}

export async function setTaskAISystemMessage(projectId, taskId, aiSystemMessage, task) {
    const batch = new BatchWrapper(getDb())
    updateTaskData(projectId, taskId, { aiSystemMessage }, batch)
    if (!task.isSubtask) {
        updateSubtasksState(projectId, task.subtaskIds, { aiSystemMessage }, batch)
    }
    batch.commit()
}
