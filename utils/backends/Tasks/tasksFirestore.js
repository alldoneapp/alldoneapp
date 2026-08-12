import { chunk, cloneDeep, intersection, isEqual, uniq } from 'lodash'
import firebase from 'firebase/compat/app'
import moment from 'moment'

import { preserveAutoAssignedGoal } from './autoAssignedGoalGuard'

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
    runHttpsCallableFunction,
    getTaskData,
    globalWatcherUnsub,
    insertFollowersUserToFeedChain,
    logDoneTasks,
    logEvent,
    mapGoalData,
    mapMilestoneData,
    mapTaskData,
    moveTasksinWorkflowFeedsChain,
    moveToTomorrowGoalReminderDateIfThereAreNotMoreTasks,
    processFollowersWhenEditTexts,
    registerTaskObservedFeeds,
    setTaskDueDateFeedsChain,
    setTaskAlertFeedsChain,
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
    setOptimisticFocusTask,
    clearOptimisticFocusTask,
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
    getCustomRecurrenceDays,
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
    TASK_ASSIGNEE_ASSISTANT_TYPE,
} from '../../../components/TaskListView/Utils/TasksHelper'
import {
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
import { isDayRateTimeLogTask, reconcileExistingDayRateTimeLog } from '../../DayRateTimeLogHelper'
import { TASK_PRIORITY_NONE, getTaskPriorityRank, normalizeTaskPriority } from '../../TaskPriority'
import { getDefaultCalendarSortIndex } from '../../CalendarTaskSortIndex'
import {
    buildObjectUpdateOperation,
    buildTaskCreateOperation,
    buildTaskUpdateOperation,
    MAX_UNDO_OPERATIONS,
    queueUndoAction,
} from '../../undo/undoActions'
import { buildTaskStateUndoOperation, buildTaskStateUndoOperations } from '../../undo/taskStateUndo'

import { getDvMainTabLink } from '../../LinkingHelper'
import { isPrivateNote } from '../../../components/NotesView/NotesHelper'
import { getGoalData } from '../Goals/goalsFirestore'
import { getOwnerId, isPrivateGoal } from '../../../components/GoalsView/GoalsHelper'
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
import { NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../openTasks'
import { buildWorkflowAiPromptOverride } from '../../../components/WorkflowView/workflowStepHelper'
import { TASK_EXECUTION_MODE_DIRECT } from '../../taskExecutionMode'
import { getAssistantSuggestedTaskRejection } from '../../suggestedTaskFlow'
import { shouldReleaseFocusOnWorkflowMove } from './workflowFocusHandoff'
import {
    buildFocusCandidateExclusions,
    finishFocusHandoff,
    isFocusHandoffSuperseded,
    isFocusTaskReleased,
    isTaskHoldingFocus,
    readOptimisticFocus,
    startFocusHandoff,
    supersedeFocusHandoffs,
} from './focusHandoffRace'
import { isTaskOnUserPlate } from './focusTaskEligibility'
// getNextTaskId removed - now handled asynchronously in onCreate trigger

const buildTaskProgressRewardKey = (taskId, completedAt, currentReviewerId) => {
    if (!taskId || completedAt == null || currentReviewerId == null) return ''
    return `task_progress:${taskId}:${completedAt}:${currentReviewerId}`
}

const getTaskTransitionUndoLabel = (task, stepToMoveId) => {
    if (stepToMoveId === DONE_STEP) return `Completed “${task.name}”`
    if (stepToMoveId === OPEN_STEP) return `Reopened “${task.name}”`
    return `Moved “${task.name}” to another workflow step`
}

const loadTaskUndoStates = async (projectId, taskIds) => {
    const uniqueTaskIds = uniq(taskIds.filter(Boolean))
    if (uniqueTaskIds.length === 0) return {}
    if (uniqueTaskIds.length > MAX_UNDO_OPERATIONS) {
        throw new Error('This task transition affects too many tasks to be safely undoable')
    }

    try {
        const snapshots = await Promise.all(
            uniqueTaskIds.map(taskId => getDb().doc(`items/${projectId}/tasks/${taskId}`).get())
        )
        const states = snapshots.reduce((result, snapshot, index) => {
            if (snapshot.exists) result[uniqueTaskIds[index]] = snapshot.data()
            return result
        }, {})
        if (Object.keys(states).length !== uniqueTaskIds.length) {
            throw new Error('A task changed before its undo state could be captured')
        }
        return states
    } catch (error) {
        console.warn('[task undo] Could not capture the state before the task transition', {
            projectId,
            error: error.message,
        })
        throw error
    }
}

const getParentRemovalChanges = (parentState, taskId) => {
    if (!parentState || !Array.isArray(parentState.subtaskIds)) return null
    const subtaskIndex = parentState.subtaskIds.indexOf(taskId)
    if (subtaskIndex < 0) return null

    const subtaskIds = [...parentState.subtaskIds]
    const subtaskNames = Array.isArray(parentState.subtaskNames) ? [...parentState.subtaskNames] : []
    subtaskIds.splice(subtaskIndex, 1)
    if (subtaskIndex < subtaskNames.length) subtaskNames.splice(subtaskIndex, 1)
    return { subtaskIds, subtaskNames }
}

const queueTaskTransitionUndo = ({ projectId, task, stepToMoveId, beforeStates, taskChanges, batch }) => {
    const operations = buildTaskStateUndoOperations(projectId, beforeStates, taskChanges)
    if (operations.length === 0) throw new Error('Could not capture the task transition for undo')
    const action = queueUndoAction({
        label: getTaskTransitionUndoLabel(task, stepToMoveId),
        operations,
        batch,
    })
    if (!action) throw new Error('Could not queue the task transition for undo')
    return action
}

async function updateLinkedContactsEditionData(projectId, task, editionDate) {
    const linkedContactIds = uniq(task?.linkedParentContactsIds || []).filter(Boolean)
    if (linkedContactIds.length === 0) return

    const { loggedUser } = store.getState()
    await Promise.all(
        linkedContactIds.map(contactId =>
            getDb().doc(`projectsContacts/${projectId}/contacts/${contactId}`).update({
                lastEditionDate: editionDate,
                lastEditorId: loggedUser.uid,
            })
        )
    )
}

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
    const maxAttempts = 3
    let attempt = 0
    let delayMs = 100 + Math.floor(Math.random() * 100)

    /* Retry transaction on concurrency errors */
    while (attempt < maxAttempts) {
        try {
            await getDb().runTransaction(async transaction => {
                const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)
                const doc = await transaction.get(ref)
                if (doc.exists) transaction.update(ref, { lastEditionDate: Date.now(), lastEditorId: editorId })
            })
            return
        } catch (error) {
            const code = error && error.code
            if ((code === 'failed-precondition' || code === 'aborted') && attempt < maxAttempts - 1) {
                // Exponential backoff with jitter
                await new Promise(resolve => setTimeout(resolve, delayMs))
                delayMs = Math.min(1000, delayMs * 2 + Math.floor(Math.random() * 50))
                attempt++
                // Optional: keep minimal debug for diagnosis
                // console.debug(`[updateTaskEditionData] Retry ${attempt} after ${code}`)
                continue
            }
            throw error
        }
    }
}

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

const isPlainObject = value => {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

// Firestore rejects undefined values (including nested maps/arrays).
const removeUndefinedForFirestore = value => {
    if (value === undefined) return undefined
    if (Array.isArray(value)) {
        return value.map(item => removeUndefinedForFirestore(item)).filter(item => item !== undefined)
    }
    if (isPlainObject(value)) {
        const cleaned = {}
        Object.entries(value).forEach(([key, nestedValue]) => {
            const sanitizedValue = removeUndefinedForFirestore(nestedValue)
            if (sanitizedValue !== undefined) cleaned[key] = sanitizedValue
        })
        return cleaned
    }
    return value
}

export async function updateTaskData(projectId, taskId, data, batch) {
    console.log(`[HumanReadableID] updateTaskData called for task ${taskId}`)
    console.log(
        `[HumanReadableID] Update data contains humanReadableId: ${data.hasOwnProperty('humanReadableId')}, value: ${
            data.humanReadableId
        }`
    )
    console.log(`[HumanReadableID] Update keys: ${Object.keys(data).join(', ')}`)
    console.log(`[HumanReadableID] Using batch: ${!!batch}`)

    updateEditionData(data)
    const safeData = removeUndefinedForFirestore(data)
    if (!safeData || Object.keys(safeData).length === 0) {
        console.warn(`[HumanReadableID] Skipping empty update payload for task ${taskId}`)
        return
    }
    const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)

    // If this update might overwrite humanReadableId and we're not in a batch, use a transaction
    // to preserve the existing humanReadableId
    if (
        !batch &&
        (!safeData.hasOwnProperty('humanReadableId') ||
            safeData.humanReadableId === null ||
            safeData.humanReadableId === undefined)
    ) {
        console.log(`[HumanReadableID] Using transaction to preserve humanReadableId for task ${taskId}`)
        try {
            await getDb().runTransaction(async transaction => {
                const taskDoc = await transaction.get(ref)
                if (taskDoc.exists) {
                    const currentTask = taskDoc.data()
                    console.log(`[HumanReadableID] Current task humanReadableId: ${currentTask.humanReadableId}`)
                    // Preserve existing humanReadableId if the update doesn't explicitly set one
                    if (currentTask.humanReadableId && !safeData.humanReadableId) {
                        console.log(
                            `[HumanReadableID] Preserving existing humanReadableId ${currentTask.humanReadableId} for task ${taskId}`
                        )
                        safeData.humanReadableId = currentTask.humanReadableId
                    }
                } else {
                    console.warn(`[HumanReadableID] Task document ${taskId} does not exist during transaction`)
                }
                console.log(`[HumanReadableID] Performing transaction update for task ${taskId}`)
                transaction.update(ref, safeData)
            })
            console.log(`[HumanReadableID] Transaction update completed for task ${taskId}`)
            return
        } catch (error) {
            console.error(
                `[HumanReadableID] Transaction failed for task ${taskId}, falling back to regular update:`,
                error.message
            )
            // Fall through to regular update
        }
    }

    // Regular update (either in batch or fallback)
    console.log(`[HumanReadableID] Performing ${batch ? 'batch' : 'regular'} update for task ${taskId}`)
    batch ? batch.update(ref, safeData) : await ref.update(safeData)
    console.log(`[HumanReadableID] Update completed for task ${taskId}`)
}

async function updateTaskDataDirectly(projectId, taskId, data, batch) {
    const safeData = removeUndefinedForFirestore(data)
    if (!safeData || Object.keys(safeData).length === 0) return
    const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)
    batch ? batch.update(ref, safeData) : await ref.update(safeData)
}

const storeLastAddedTaskId = taskId => {
    store.dispatch(setLastTaskAddedId(taskId))
}

const getTaskRecurrence = task => {
    const recurrence = task?.recurrence
    return recurrence && typeof recurrence === 'object' ? recurrence.type : recurrence
}

const shouldSaveRecurrenceOriginalDueDate = (task, previousDueDate, nextDueDate, isObservedTask = false) => {
    const recurrence = getTaskRecurrence(task)
    return (
        !isObservedTask &&
        recurrence &&
        recurrence !== RECURRENCE_NEVER &&
        !task?.recurrenceOriginalDueDate &&
        typeof previousDueDate === 'number' &&
        typeof nextDueDate === 'number' &&
        nextDueDate > previousDueDate
    )
}

const getRecurrenceOriginalDueDateUpdate = (task, previousDueDate, nextDueDate, isObservedTask = false) => {
    return shouldSaveRecurrenceOriginalDueDate(task, previousDueDate, nextDueDate, isObservedTask)
        ? { recurrenceOriginalDueDate: previousDueDate }
        : {}
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
        const startsInWorkflow = taskCopy.workflowTask === true
        taskCopy.userIds =
            startsInWorkflow && Array.isArray(taskCopy.userIds) && taskCopy.userIds.length > 0
                ? taskCopy.userIds
                : [taskCopy.userId]
        taskCopy.currentReviewerId =
            startsInWorkflow && taskCopy.currentReviewerId ? taskCopy.currentReviewerId : taskCopy.userId
        taskCopy.observersIds = taskCopy.observersIds ? taskCopy.observersIds : []
        taskCopy.dueDateByObserversIds = taskCopy.dueDateByObserversIds ? taskCopy.dueDateByObserversIds : {}
        taskCopy.estimationsByObserverIds = taskCopy.estimationsByObserverIds ? taskCopy.estimationsByObserverIds : {}
        taskCopy.stepHistory =
            startsInWorkflow && Array.isArray(taskCopy.stepHistory) && taskCopy.stepHistory.length > 0
                ? taskCopy.stepHistory
                : [OPEN_STEP]
        taskCopy.hasStar = taskCopy.hasStar ? taskCopy.hasStar : '#FFFFFF'
        taskCopy.priority = normalizeTaskPriority(taskCopy.priority)
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
        taskCopy.recurrenceOriginalDueDate = taskCopy.recurrenceOriginalDueDate || null
        taskCopy.recurrenceBaseDateOverride = taskCopy.recurrenceBaseDateOverride || null
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
        taskCopy.aiReasoningEffort = taskCopy.aiReasoningEffort || null
        taskCopy.aiSystemMessage = taskCopy.aiSystemMessage || null
        // Webhook task metadata (for external webhook integrations)
        taskCopy.taskMetadata = taskCopy.taskMetadata || null
        taskCopy.autoFollowUpManaged = taskCopy.autoFollowUpManaged === true
        taskCopy.autoFollowUpType = taskCopy.autoFollowUpType || null
        taskCopy.autoFollowUpContactId = taskCopy.autoFollowUpContactId || null
        taskCopy.autoFollowUpStatusId = taskCopy.autoFollowUpStatusId || null

        // Debug log for webhook tasks
        if (taskCopy.taskMetadata) {
            console.log('🔍 UPLOAD TASK: Task has taskMetadata:', {
                taskId,
                taskMetadata: taskCopy.taskMetadata,
                isWebhookTask: taskCopy.taskMetadata.isWebhookTask,
            })
        }

        updateEditionData(taskCopy)

        // Human readable ID will be generated asynchronously in onCreate trigger
        // This improves task creation performance by removing the blocking transaction
        taskCopy.humanReadableId = null
        console.log(`[HumanReadableID] Task ${taskId} created with humanReadableId: null`)

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

        console.log(
            `[HumanReadableID] About to commit task ${taskId} to database with humanReadableId: ${taskCopy.humanReadableId}`
        )
        console.log(`🚨 FIRESTORE PATH: items/${projectId}/tasks/${taskId} 🚨`)
        const safeTaskCopy = removeUndefinedForFirestore(taskCopy)

        awaitForTaskCreation
            ? await getDb()
                  .doc(`items/${projectId}/tasks/${taskId}`)
                  .set(safeTaskCopy)
                  .then(() => {
                      queueUndoAction({
                          label: `Created task “${taskCopy.name}”`,
                          operations: [buildTaskCreateOperation(projectId, taskId, safeTaskCopy)],
                      })
                      console.log(`[HumanReadableID] Task ${taskId} committed to database (awaited)`)
                      scheduleResetLastAddedTaskId(taskId)
                  })
            : getDb()
                  .doc(`items/${projectId}/tasks/${taskId}`)
                  .set(safeTaskCopy)
                  .then(() => {
                      queueUndoAction({
                          label: `Created task “${taskCopy.name}”`,
                          operations: [buildTaskCreateOperation(projectId, taskId, safeTaskCopy)],
                      })
                      console.log(`[HumanReadableID] Task ${taskId} committed to database (non-awaited)`)
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

export async function uploadNewSubTask(projectId, task, newSubTask, inFollowUpProcess) {
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

        // Human readable ID will be generated asynchronously in onCreate trigger
        // This improves subtask creation performance by removing the blocking transaction
        subTask.humanReadableId = null

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

        logEvent('new_task', {
            taskOwnerUid: task.userId,
            estimation: task.estimations[OPEN_STEP],
            isSubtask: true,
        })
        return mapTaskData(newTaskId, subTask)
    }

    return null
}

/**
 * @deprecated This function has been moved to cloud functions for reliability
 * Recurring task creation now happens in functions/Tasks/recurringTasksCloud.js
 * via the onUpdateTask cloud function trigger
 */
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
                if (today === 5) {
                    // Friday: next workday is Monday (add 3 days)
                    date.add(3, 'days')
                } else if (today === 6) {
                    // Saturday: next workday is Monday (add 2 days)
                    date.add(2, 'days')
                } else if (today === 7) {
                    // Sunday: next workday is Monday (add 1 day)
                    date.add(1, 'days')
                } else {
                    // Monday-Thursday: next workday is tomorrow (add 1 day)
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

        const customDays = getCustomRecurrenceDays(recurrence)
        if (customDays) {
            recurrenceMap[recurrence] = baseDate.clone().add(customDays, 'days')
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

        uploadNewTask(projectId, task, null, null, false, false).then(newTask => {
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
    const taskId = task.id
    console.log(`[HumanReadableID] uploadTaskByQuill called for task ${taskId}`)
    console.log(`[HumanReadableID] Task humanReadableId before processing: ${task.humanReadableId}`)

    updateEditionData(task)
    task.sortIndex = generateSortIndex()
    delete task.id

    // Preserve humanReadableId when using set operation
    // This is critical since .set() replaces the entire document
    if (!task.humanReadableId) {
        console.log(`[HumanReadableID] Task ${taskId} has no humanReadableId, attempting to preserve existing one`)
        try {
            const currentTaskDoc = await getDb().doc(`items/${projectId}/tasks/${taskId}`).get()
            if (currentTaskDoc.exists) {
                const currentTask = currentTaskDoc.data()
                console.log(`[HumanReadableID] Current task humanReadableId: ${currentTask.humanReadableId}`)
                if (currentTask.humanReadableId) {
                    task.humanReadableId = currentTask.humanReadableId
                    console.log(
                        `[HumanReadableID] Preserved humanReadableId ${currentTask.humanReadableId} for task ${taskId}`
                    )
                }
            } else {
                console.warn(
                    `[HumanReadableID] Task document ${taskId} does not exist, cannot preserve humanReadableId`
                )
            }
        } catch (error) {
            console.error(`[HumanReadableID] Failed to preserve humanReadableId for task ${taskId}:`, error.message)
        }
    } else {
        console.log(`[HumanReadableID] Task ${taskId} already has humanReadableId: ${task.humanReadableId}`)
    }

    console.log(`[HumanReadableID] Setting task ${taskId} with humanReadableId: ${task.humanReadableId}`)
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
            // Skip creating mention task if user is mentioning themselves
            if (userId === uid) return

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
                // Pass notGenerateMentionTasks: true to prevent recursive mention task creation
                uploadNewTask(projectId, genericTask, null, null, true, false)
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
        [`lastAssistantCommentData.${projectId}`]: updateDate,
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

    // Follow-up comments must never trigger an assistant reply, even when the
    // task/thread has an assistant enabled — hence skipAssistantTrigger = true.
    const linkToNewTask = `${window.location.origin}/projects/${projectId}/tasks/${newTaskId}/properties`
    const commentOldTask = `Follow up task created: ${linkToNewTask}`
    createObjectMessage(projectId, task.id, commentOldTask, 'tasks', STAYWARD_COMMENT, null, null, true)

    if (comment && comment.trim()) {
        createObjectMessage(projectId, task.id, comment, 'tasks', STAYWARD_COMMENT, null, null, true)
        createObjectMessage(projectId, newTaskId, comment, 'tasks', STAYWARD_COMMENT, null, null, true)
    }

    createFollowUpBacklinksToNotes(projectId, newTaskId, task.id)

    creatFollowUpTaskFeedChain(projectId, task, newEstimation, followUpTask, newTaskId)
}

export async function updateTask(projectId, task, oldTask, oldAssignee, comment, commentMentions, isObservedTask) {
    // AT-2277 - every editor saves the whole task document from the copy it took when it opened, so
    // a copy older than a background goal assignment would write `parentGoalId: null` straight over
    // it. Restore the goal fields from the live task when this payload never saw the assignment;
    // deliberate goal changes are untouched. See autoAssignedGoalGuard.js.
    task = preserveAutoAssignedGoal(task, oldTask)

    const taskId = task.id
    console.log(`[HumanReadableID] updateTask called for task ${taskId}`)
    console.log(`[HumanReadableID] Old task humanReadableId: ${oldTask.humanReadableId}`)
    console.log(`[HumanReadableID] New task humanReadableId: ${task.humanReadableId}`)

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
        const { dueDateByObserversIds, estimationsByObserverIds } =
            TasksHelper.mergeDueDateAndEstimationsByObserversIds(
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
        taskToStore.priority = TASK_PRIORITY_NONE
        Object.assign(taskToStore, getRecurrenceOriginalDueDateUpdate(oldTask, oldTask.dueDate, task.dueDate))
        subtasksUpdateData.timesPostponed = firebase.firestore.FieldValue.increment(1)
        subtasksUpdateData.priority = TASK_PRIORITY_NONE
        logEvent('task_postponed')
    }

    const endOfToday = moment().endOf('day').valueOf()
    // AT-2191: same optimistic-aware check as setTaskDueDate — a due-date change made from the
    // detailed view while an earlier focus swap is still unconfirmed must swap focus too.
    let focusHandoffId = null
    if (endOfToday < task.dueDate && isFocusTaskForUser(projectId, task.id, task.userId)) {
        focusHandoffId = startFocusHandoff(task.id)
        setOptimisticNextFocusTask(projectId, oldTask, task.userId)
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

    await batch.commit()

    if (task.done && !isDayRateTimeLogTask(task)) {
        await reconcileExistingDayRateTimeLog(projectId, task.userId, task.completed)
    }

    if (focusHandoffId !== null) {
        await runFocusHandoff(focusHandoffId, projectId, task.userId, oldTask.parentGoalId, taskId)
    }

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

export async function setTaskPriority(projectId, task, priority) {
    const normalizedPriority = normalizeTaskPriority(priority)
    if (normalizeTaskPriority(task.priority) === normalizedPriority) return

    const oldAssignee = TasksHelper.getTaskOwner(task.userId, projectId)
    const result = await updateTask(
        projectId,
        { ...task, priority: normalizedPriority },
        task,
        oldAssignee,
        '',
        [],
        false
    )
    queueUndoAction({
        label: `Changed priority for “${task.name}”`,
        operations: [
            buildTaskUpdateOperation(
                projectId,
                task.id,
                { priority: normalizeTaskPriority(task.priority) },
                { priority: normalizedPriority }
            ),
        ],
    })
    return result
}

export const setTaskAssistant = async (projectId, taskId, assistantId, needGenerateUpdate) => {
    const batch = new BatchWrapper(getDb())
    updateTaskData(projectId, taskId, { assistantId }, batch)
    await updateChatAssistantWithoutFeeds(projectId, taskId, assistantId, batch)
    await batch.commit()
    if (needGenerateUpdate) await createTaskAssistantChanged(projectId, assistantId, taskId, null, null)
}

export const setTaskNote = async (projectId, taskId, noteId) => {
    const updateData = { noteId }
    updateEditionData(updateData)
    await updateTaskDataDirectly(projectId, taskId, updateData, null)
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
        if (!task.parentId) {
            const before = {
                recurrence: task.recurrence,
                timesDoneInExpectedDay: task.timesDoneInExpectedDay || 0,
                timesDone: task.timesDone || 0,
            }
            const after = {
                recurrence,
                timesDoneInExpectedDay: recurrence === RECURRENCE_NEVER ? 0 : task.timesDoneInExpectedDay || 0,
                timesDone: recurrence === RECURRENCE_NEVER ? 0 : task.timesDone || 0,
            }
            queueUndoAction({
                label: `Changed recurrence for “${task.name}”`,
                operations: [buildTaskUpdateOperation(projectId, taskId, before, after)],
                batch,
            })
        }
        const followTaskData = {
            followObjectsType: FOLLOWER_TASKS_TYPE,
            followObjectId: taskId,
            followObject: task,
            feedCreator: store.getState().loggedUser,
        }
        await tryAddFollower(projectId, followTaskData, batch)
        await createTaskRecurrenceChangedFeed(projectId, task, taskId, task.recurrence, recurrence, batch)

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
        await batch.commit()
        task.recurrence = recurrence
    }
}

export async function setTaskHighlight(projectId, taskId, highlightColor, task) {
    const batch = new BatchWrapper(getDb())
    const isHighlight = highlightColor.toLowerCase() !== '#ffffff'

    queueUndoAction({
        label: `${isHighlight ? 'Highlighted' : 'Unhighlighted'} “${task.name}”`,
        operations: [
            buildTaskUpdateOperation(
                projectId,
                taskId,
                { hasStar: task.hasStar || '#FFFFFF' },
                { hasStar: highlightColor }
            ),
        ],
        batch,
    })

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

    const undoAction = queueUndoAction({
        label: `${isHighlight ? 'Highlighted' : 'Unhighlighted'} ${tasks.length} tasks`,
        operations: tasks.map(task =>
            buildTaskUpdateOperation(
                task.projectId,
                task.id,
                { hasStar: task.hasStar || '#FFFFFF' },
                { hasStar: highlightColor }
            )
        ),
        batch: taskBatch,
    })
    if (undoAction) batch.currentUndoActionId = undoAction.actionId

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

    await batch.commit()

    if (task.done && stepId === OPEN_STEP && !isDayRateTimeLogTask(task)) {
        await reconcileExistingDayRateTimeLog(projectId, task.userId, task.completed)
    }

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
    const operations = [
        buildTaskUpdateOperation(
            projectId,
            taskId,
            { name: task.name, extendedName: oldName || task.extendedName || task.name },
            { name: cleanedName, extendedName: name.trim() }
        ),
    ]
    const chatSnapshot = await getDb().doc(`chatObjects/${projectId}/chats/${taskId}`).get()
    if (chatSnapshot.exists) {
        operations.push(
            buildObjectUpdateOperation('chat', projectId, taskId, { title: chatSnapshot.data().title }, { title: name })
        )
    }

    if (task.noteId) {
        const noteSnapshot = await getDb().doc(`noteItems/${projectId}/notes/${task.noteId}`).get()
        if (noteSnapshot.exists) {
            const note = noteSnapshot.data()
            const nextNoteTitle = TasksHelper.getNoteTitleForTask({
                ...task,
                name: cleanedName,
                extendedName: name.trim(),
            })
            operations.push(
                buildObjectUpdateOperation(
                    'note',
                    projectId,
                    task.noteId,
                    { title: note.title, extendedTitle: note.extendedTitle },
                    {
                        title: TasksHelper.getTaskNameWithoutMeta(nextNoteTitle).toLowerCase(),
                        extendedTitle: nextNoteTitle,
                    }
                )
            )
        }
    }

    let parentTask = null
    if (task.parentId) {
        const parentSnapshot = await getDb().doc(`items/${projectId}/tasks/${task.parentId}`).get()
        if (parentSnapshot.exists) {
            parentTask = parentSnapshot.data()
            const subtaskNames = [...(parentTask.subtaskNames || [])]
            const subtaskIndex = (parentTask.subtaskIds || []).indexOf(task.id)
            if (subtaskIndex >= 0) subtaskNames[subtaskIndex] = name
            operations.push(
                buildTaskUpdateOperation(
                    projectId,
                    task.parentId,
                    { subtaskNames: parentTask.subtaskNames || [] },
                    { subtaskNames }
                )
            )
        }
    }

    queueUndoAction({ label: `Renamed task to “${cleanedName}”`, operations, batch })

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
        await updateNoteTitleWithoutFeed(
            projectId,
            task.noteId,
            TasksHelper.getNoteTitleForTask({ ...task, name: cleanedName, extendedName: name.trim() }),
            batch
        )
    }
    await updateChatTitleWithoutFeeds(projectId, taskId, name, batch)

    if (task.parentId) {
        const parentRef = getDb().doc(`items/${projectId}/tasks/${task.parentId}`)
        parentTask = parentTask || (await parentRef.get()).data()

        const subtaskIds = parentTask.subtaskIds || []
        const subtaskNames = [...(parentTask.subtaskNames || [])]
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

    queueUndoAction({
        label: `Changed description for “${task.name}”`,
        operations: [
            buildTaskUpdateOperation(projectId, taskId, { description: oldDescription || '' }, { description }),
        ],
        batch,
    })

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
        const shouldSetOptimisticFocus = !externalBatch

        if (shouldSetOptimisticFocus) {
            // AT-2191: the user picked a focus task by hand, which outranks any postpone whose
            // backend search is still running. Without this, that search could land afterwards and
            // silently replace the task they just chose.
            supersedeFocusHandoffs()

            const optimisticTaskId = taskToSetFocusOn ? taskToSetFocusOn.id : null
            const optimisticProjectId = taskToSetFocusOn
                ? projectId
                : assignee.inFocusTaskProjectId
                  ? assignee.inFocusTaskProjectId
                  : projectId
            store.dispatch(
                setOptimisticFocusTask(optimisticTaskId, optimisticProjectId, taskToSetFocusOn?.parentGoalId, userId)
            )
        }

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
                // Default behavior: hand the task an ordinary "just moved" sortIndex.
                // Need to read the task data. If in a transaction (externalBatch exists), this read might need to be part of it or handled carefully.
                // For simplicity here, we'll assume non-transactional read if not explicitly passed, or that externalBatch handles gets.
                try {
                    // This read should ideally be consistent with the batch if externalBatch is a transaction
                    const oldFocusedTaskSnap = externalBatch
                        ? await externalBatch.get(oldFocusedTaskRef) // Assumes externalBatch can do gets if it's a transaction
                        : await oldFocusedTaskRef.get()

                    if (oldFocusedTaskSnap.exists) {
                        // AT-2259 - a task leaving focus rejoins the list at the top like any other
                        // freshly moved task. It used to be dropped back onto its calendar event
                        // start, which pinned it above everything in its group forever.
                        // AT-2270 - except a calendar task, which rejoins the calendar block at the
                        // bottom of the group instead. The focus boost overwrote whatever ordering
                        // it had, so the only sensible value to come back to is its default one -
                        // otherwise an auto-focused meeting ends up parked on top of the list.
                        const oldFocusedTaskData = oldFocusedTaskSnap.data()
                        const calendarSortIndex = getDefaultCalendarSortIndex(oldFocusedTaskData?.calendarData)
                        sortIndexForOldTask = calendarSortIndex !== null ? calendarSortIndex : generateSortIndex()
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

        if (!externalBatch) {
            try {
                await batch.commit()
            } catch (error) {
                store.dispatch(clearOptimisticFocusTask())
                throw error
            }
        }

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

export const rebuildTaskLastCommentData = async (projectId, taskId) => {
    const commentsRef = getDb().collection(`chatComments/${projectId}/tasks/${taskId}/comments`)
    const [taskDoc, commentsSnapshot] = await Promise.all([
        getDb().doc(`items/${projectId}/tasks/${taskId}`).get(),
        commentsRef.get(),
    ])

    if (!taskDoc.exists) return

    const comments = commentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    const validComments = comments
        .filter(comment => typeof comment.commentText === 'string' && comment.commentText.trim().length > 0)
        .sort((a, b) => {
            const aCreated = typeof a.created === 'number' ? a.created : 0
            const bCreated = typeof b.created === 'number' ? b.created : 0
            if (aCreated !== bCreated) return bCreated - aCreated

            return String(b.id || '').localeCompare(String(a.id || ''))
        })

    if (comments.length > 0 && validComments.length === 0) {
        console.warn('[TaskComments] rebuildTaskLastCommentData found task comments without visible text', {
            projectId,
            taskId,
            commentsAmount: comments.length,
        })
    }

    if (comments.length === 0) {
        const currentCommentsData = taskDoc.data()?.commentsData
        if (currentCommentsData) {
            console.warn(
                '[TaskComments] rebuildTaskLastCommentData clearing stale task commentsData because no comments exist',
                {
                    projectId,
                    taskId,
                    currentAmount: currentCommentsData.amount || 0,
                }
            )
            await taskDoc.ref.update({ commentsData: null })
        }
        return null
    }

    const latestComment = validComments[0]
    const commentsData =
        latestComment && latestComment.commentText
            ? {
                  lastComment: shrinkTagText(
                      cleanTextMetaData(removeFormatTagsFromText(latestComment.commentText), true).trim() || 'Comment',
                      LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN
                  ),
                  lastCommentType: latestComment.commentType || null,
                  lastCommentOwnerId: latestComment.creatorId || '',
                  amount: comments.length,
              }
            : null

    const currentCommentsData = taskDoc.data()?.commentsData || null
    if (currentCommentsData === null && commentsData !== null) {
        console.warn(
            '[TaskComments] rebuildTaskLastCommentData restoring missing task commentsData from stored comments',
            {
                projectId,
                taskId,
                commentsAmount: comments.length,
            }
        )
    }

    await taskDoc.ref.update({ commentsData })
    return commentsData
}

export const resetTaskLastCommentData = async (projectId, taskId) => {
    const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)
    const doc = await ref.get()
    if (doc.exists) {
        const data = doc.data()
        if (data.commentsData && data.commentsData.amount > 0) {
            ref.update({
                [`commentsData.lastComment`]: null,
                [`commentsData.lastCommentType`]: null,
                [`commentsData.amount`]: 0,
            })
        }
    }
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

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    const sortIndex = generateSortIndex()

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

        // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
        // The event start lives in calendarData.start and is read from there where it is needed.
        const sortIndex = generateSortIndex()

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

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    taskCopy.sortIndex = generateSortIndex()

    // If this is a calendar task and the user manually moved it, pin it to the new project
    if (taskCopy.calendarData) {
        taskCopy.calendarData = {
            ...taskCopy.calendarData,
            pinnedToProjectId: newProject.id,
        }
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
    await getDb().doc(`items/${newProject.id}/tasks/${task.id}`).set(removeUndefinedForFirestore(taskCopy))

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

export async function setTaskProjectWithGoal(currentProject, newProject, task, goal) {
    const { loggedUser, projectUsers } = store.getState()

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

    // Preserve the goal association with updated privacy settings
    taskCopy.parentGoalId = goal.id
    taskCopy.parentGoalIsPublicFor = goal.isPublicFor
    taskCopy.lockKey = goal.lockKey || ''
    if (taskCopy.goalSuggestion?.status === 'pending' || taskCopy.goalSuggestion?.status === 'classifying') {
        taskCopy.goalSuggestion = {
            ...taskCopy.goalSuggestion,
            status: 'superseded',
            resolvedAt: Date.now(),
            resolvedBy: loggedUser.uid,
        }
    }

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    taskCopy.sortIndex = generateSortIndex()

    // If this is a calendar task and the user manually moved it, pin it to the new project
    if (taskCopy.calendarData) {
        taskCopy.calendarData = {
            ...taskCopy.calendarData,
            pinnedToProjectId: newProject.id,
        }
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
    await getDb().doc(`items/${newProject.id}/tasks/${task.id}`).set(removeUndefinedForFirestore(taskCopy))

    const promises = []
    promises.push(
        createSubtasksCopies(currentProject.id, newProject.id, task.id, taskCopy, subtaskIds, null, false, false)
    )
    promises.push(
        getDb().doc(`items/${currentProject.id}/tasks/${task.id}`).update({ movingToOtherProjectId: newProject.id })
    )
    await Promise.all(promises)

    const batch = new BatchWrapper(getDb())
    updateTaskData(currentProject.id, task.id, {}, batch)
    batch.delete(getDb().doc(`items/${currentProject.id}/tasks/${task.id}`))
    batch.commit()

    setTaskProjectFeedsChain(currentProject, newProject, task, null, null)
}

export async function setTaskParentGoal(projectId, taskId, task, goal, externalBatch, options = {}) {
    const goalId = goal ? goal.id : null
    const parentGoalIsPublicFor = goal ? goal.isPublicFor : null
    const lockKey = goal && goal.lockKey ? goal.lockKey : ''
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())
    const resolvedGoalSuggestion = options.goalSuggestion
        ? options.goalSuggestion
        : task.goalSuggestion?.status === 'pending' || task.goalSuggestion?.status === 'classifying'
          ? {
                ...task.goalSuggestion,
                status: 'superseded',
                resolvedAt: Date.now(),
                resolvedBy: store.getState().loggedUser.uid,
            }
          : task.goalSuggestion

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    const sortIndex = generateSortIndex()

    const updateData = {
        parentGoalId: goalId,
        parentGoalIsPublicFor,
        lockKey,
        sortIndex,
        ...(resolvedGoalSuggestion ? { goalSuggestion: resolvedGoalSuggestion } : {}),
    }

    if (task.parentId) {
        await deleteSubTaskFromParent(projectId, taskId, task, batch)
        updateData.parentId = null
        updateData.isSubtask = false
        updateTaskData(projectId, taskId, updateData, batch)
    } else {
        updateTaskData(projectId, taskId, updateData, batch)
    }

    if (!externalBatch) batch.commit()

    setTaskParentGoalFeedsChain(projectId, taskId, goalId, task.parentGoalId, task)
    return updateData
}

export async function acceptTaskGoalSuggestion(projectId, task, goal) {
    if (!task?.goalSuggestion || task.goalSuggestion.status !== 'pending' || task.goalSuggestion.goalId !== goal?.id) {
        return
    }

    const batch = new BatchWrapper(getDb())
    const goalSuggestion = {
        ...task.goalSuggestion,
        status: 'accepted',
        resolvedAt: Date.now(),
        resolvedBy: store.getState().loggedUser.uid,
    }
    const afterChanges = await setTaskParentGoal(projectId, task.id, task, goal, batch, { goalSuggestion })
    const operation = buildTaskStateUndoOperation(projectId, task.id, task, afterChanges)

    if (operation) {
        queueUndoAction({
            label: `Added “${task.name}” to “${goal.name || goal.extendedName}”`,
            operations: [operation],
            batch,
            source: 'task_goal_suggestion',
        })
    }
    await batch.commit()
}

export function dismissTaskGoalSuggestion(projectId, task) {
    if (!task?.goalSuggestion || task.goalSuggestion.status !== 'pending') return

    return updateTaskData(projectId, task.id, {
        goalSuggestion: {
            ...task.goalSuggestion,
            status: 'dismissed',
            resolvedAt: Date.now(),
            resolvedBy: store.getState().loggedUser.uid,
        },
    })
}

/**
 * AT-2160: read a task doc from Firestore's local cache, falling back to the server when it is not
 * cached. Used on paths where the read is only needed to build an undo record and must not delay
 * the write that the user is waiting to see.
 */
export async function getTaskSnapshotCacheFirst(projectId, taskId) {
    const ref = getDb().doc(`items/${projectId}/tasks/${taskId}`)
    try {
        return await ref.get({ source: 'cache' })
    } catch (error) {
        return ref.get()
    }
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
    const didResetPriority = !isObservedTask && !fromSetTaskFocus && dueDate > task.dueDate
    // APPLY FIX HERE: Add !fromSetTaskFocus to the condition
    if (didResetPriority) {
        // REMOVE LOGGING HERE
        // console.log(
        //     `[setTaskDueDate] Incrementing timesPostponed for task ${taskId}. Old dueDate=${task.dueDate}, New dueDate=${dueDate}`
        // )
        commonFields.timesPostponed = firebase.firestore.FieldValue.increment(1)
        commonFields.priority = TASK_PRIORITY_NONE
        Object.assign(commonFields, getRecurrenceOriginalDueDateUpdate(task, task.dueDate, dueDate, isObservedTask))
        logEvent('task_postponed')
        // REMOVE LOGGING HERE (else block)
        // } else {
        //      console.log(
        //         `[setTaskDueDate] NOT incrementing timesPostponed for task ${taskId}. Condition (!isObservedTask && dueDate > task.dueDate) is false. fromSetTaskFocus=${fromSetTaskFocus}`
        //     )
    }

    const assigneeForUndo = TasksHelper.getUserInProject(projectId, task.userId)
    const canUndoDueDate =
        !isObservedTask && !fromSetTaskFocus && !task.parentId && assigneeForUndo?.inFocusTaskId !== taskId
    if (canUndoDueDate) {
        const before = { dueDate: task.dueDate, sortIndex: task.sortIndex }
        const after = { dueDate, sortIndex: commonFields.sortIndex }
        if (didResetPriority) {
            before.priority = normalizeTaskPriority(task.priority)
            after.priority = TASK_PRIORITY_NONE
            before.timesPostponed = task.timesPostponed || 0
            after.timesPostponed = (task.timesPostponed || 0) + 1
            if (commonFields.recurrenceOriginalDueDate !== undefined) {
                before.recurrenceOriginalDueDate = task.recurrenceOriginalDueDate || null
                after.recurrenceOriginalDueDate = commonFields.recurrenceOriginalDueDate
            }
        }

        const operations = [buildTaskUpdateOperation(projectId, taskId, before, after)]
        if (task.subtaskIds?.length > 0) {
            // AT-2160: these reads only exist to record undo's "before" values, but they used to be
            // plain server gets sitting in front of every write below — so postponing a task that
            // has subtasks moved nothing on screen until a full round trip came back, while the
            // same task without subtasks moved in the same frame. Subtasks of a task you are
            // looking at are already in the local cache (the task-list listener keeps them there),
            // so read from it and only fall back to the server on a genuine miss.
            const subtaskSnapshots = await Promise.all(
                task.subtaskIds.map(subtaskId => getTaskSnapshotCacheFirst(projectId, subtaskId))
            )
            subtaskSnapshots.forEach(snapshot => {
                if (!snapshot.exists) return
                const subtask = snapshot.data()
                const subtaskBefore = { dueDate: subtask.dueDate }
                const subtaskAfter = { dueDate }
                if (didResetPriority) {
                    subtaskBefore.priority = normalizeTaskPriority(subtask.priority)
                    subtaskAfter.priority = TASK_PRIORITY_NONE
                    subtaskBefore.timesPostponed = subtask.timesPostponed || 0
                    subtaskAfter.timesPostponed = (subtask.timesPostponed || 0) + 1
                }
                operations.push(buildTaskUpdateOperation(projectId, snapshot.id, subtaskBefore, subtaskAfter))
            })
        }
        queueUndoAction({
            label: `Changed reminder for “${task.name}”`,
            operations,
            batch,
        })
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
                ? {
                      ...updateData,
                      priority: TASK_PRIORITY_NONE,
                      timesPostponed: firebase.firestore.FieldValue.increment(1),
                  }
                : updateData
        updateSubtasksState(projectId, task.subtaskIds, subtasksUpdate, batch)
    }

    const endOfToday = moment().endOf('day').valueOf()
    let focusHandoffId = null // AT-2191: set once this postpone owns a focus handoff
    if (endOfToday < dueDate) {
        // AT-2191: matches the optimistic focus too, so postponing the task a previous postpone just
        // handed focus to still swaps — the confirmed inFocusTaskId lags a full round trip behind.
        if (isFocusTaskForUser(projectId, task.id, task.userId)) {
            focusHandoffId = startFocusHandoff(task.id)
            setOptimisticNextFocusTask(projectId, task)
            // Instead of just removing focus, we'll find a new one after committing the postpone changes
            // We remove the direct call to updateFocusedTask here
        }
    }

    if (!externalBatch) await batch.commit()

    // If the postponed task was the focus task, find and set a new one now
    if (focusHandoffId !== null) {
        await runFocusHandoff(focusHandoffId, projectId, task.userId, task.parentGoalId, taskId)
    }

    setTaskDueDateFeedsChain(projectId, taskId, dueDate, task, isObservedTask, didResetPriority)
}

export async function setTaskAlert(projectId, taskId, alertEnabled, alertTime, task, externalBatch) {
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    let updateData = {
        alertEnabled: alertEnabled,
    }

    // If alert is enabled and we have a valid time, ensure dueDate reflects that time
    if (alertEnabled && alertTime) {
        // Use existing dueDate if present; otherwise base it on 'today'
        let baseDate = task.dueDate ? moment(task.dueDate) : moment()

        // TIMEZONE FIX: If alertTime has a timezone offset (from cloud functions),
        // we need to apply the same offset to baseDate before setting the time.
        // This ensures we set the hour/minute in the user's timezone, not UTC.
        if (alertTime._offset !== undefined || alertTime._isUTC !== undefined) {
            // alertTime was created with .utcOffset() - apply same offset to baseDate
            baseDate = baseDate.utcOffset(alertTime.utcOffset())
        }

        const newDueDate = baseDate
            .clone()
            .hour(alertTime.hour())
            .minute(alertTime.minute())
            .second(0)
            .millisecond(0)
            .valueOf()

        updateData.dueDate = newDueDate
        // Reset alert trigger so a new notification can be generated at the new time
        updateData.alertTriggered = false
    }

    console.log('[setTaskAlert] Updating task due to alert change:', {
        projectId,
        taskId,
        alertEnabled,
        alertTime: alertTime && alertTime.format ? alertTime.format('HH:mm Z') : null,
        alertTimeOffset: alertTime && alertTime.utcOffset ? alertTime.utcOffset() : null,
        resultingDueDate: updateData.dueDate || null,
        resultingDueDateISO: updateData.dueDate ? new Date(updateData.dueDate).toISOString() : null,
    })

    updateTaskData(projectId, taskId, updateData, batch)

    if (!externalBatch) await batch.commit()

    // Generate feed for alert change
    setTaskAlertFeedsChain(projectId, taskId, alertEnabled, alertTime, task)
}

export async function setTaskToBacklog(projectId, taskId, task, isObservedTask, externalBatch) {
    const { loggedUser, currentUser } = store.getState()
    const currentUserId = currentUser.uid
    const batch = externalBatch ? externalBatch : new BatchWrapper(getDb())

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    const sortIndex = generateSortIndex()

    const commonFields = {
        sortIndex,
        timesPostponed: firebase.firestore.FieldValue.increment(1),
    }
    if (!isObservedTask) {
        commonFields.priority = TASK_PRIORITY_NONE
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

        const subtasksUpdate = {
            ...updateData,
            ...(isObservedTask ? {} : { priority: TASK_PRIORITY_NONE }),
            timesPostponed: firebase.firestore.FieldValue.increment(1),
        }
        updateSubtasksState(projectId, task.subtaskIds, subtasksUpdate, batch)
    }

    // AT-2191: same optimistic-aware check as setTaskDueDate — sending the currently focused task to
    // Someday must swap focus even while an earlier swap is still unconfirmed.
    let focusHandoffId = null
    if (!isObservedTask && isFocusTaskForUser(projectId, task.id, task.userId)) {
        focusHandoffId = startFocusHandoff(task.id)
        setOptimisticNextFocusTask(projectId, task)
    }

    if (!externalBatch) await batch.commit()

    if (focusHandoffId !== null) {
        await runFocusHandoff(focusHandoffId, projectId, task.userId, task.parentGoalId, taskId)
    }

    setTaskToBacklogFeedsChain(projectId, taskId, task, isObservedTask, !isObservedTask)
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
    const { parentId, subtaskIds = [], userId, stepHistory, userIds } = task
    const transitionDate = Date.now()
    const undoBeforeStates = await loadTaskUndoStates(projectId, [task.id, parentId, ...subtaskIds])

    if (task.workflowTask && stepToMoveId === OPEN_STEP) {
        const firstWorkflowStepId = getWorkflowStepsIdsSorted(getUserWorkflow(projectId, userId, task))[0]
        if (!firstWorkflowStepId) return
        stepToMoveId = firstWorkflowStepId
    }

    // Persist the visible handoff before moving the task. Its id and prompt are then written with
    // the destination step below, so the AI run never races the comment write or duplicates it.
    const transitionCommentId = comment
        ? await createObjectMessage(projectId, task.id, comment, 'tasks', commentType, null, null, true)
        : null

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
            dueDate: transitionDate,
            completedTime: null,
        }
    } else if (stepToMoveId === DONE_STEP) {
        forwardDirection = true
        updateData = {
            userIds: [userId],
            currentReviewerId: DONE_STEP,
            completed: transitionDate,
        }
    } else {
        workflow = getUserWorkflow(projectId, userId, task)
        const workflowStepsIds = getWorkflowStepsIdsSorted(workflow)
        const stepToMoveIndex = workflowStepsIds.indexOf(stepToMoveId)
        const currentStepId = stepHistory[stepHistory.length - 1]
        const currentStepIndex = workflowStepsIds.indexOf(currentStepId)
        forwardDirection = stepToMoveIndex > currentStepIndex

        if (forwardDirection) {
            const { reviewerUid } = workflow[stepToMoveId]
            updateData = {
                userIds: [...userIds, reviewerUid],
                currentReviewerId: reviewerUid,
                completed: transitionDate,
                stepHistory: [...stepHistory, stepToMoveId],
                dueDate: transitionDate,
            }
        } else {
            const newUserIds = [task.userId]
            const newStepHistory = task.workflowTask ? [] : [OPEN_STEP]
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
                completed: transitionDate,
            }
        }
    }

    if (!task.parentId && forwardDirection) {
        const reviewerId = userIds[userIds.length - 1]
        earnGold(projectId, reviewerId, MAX_GOLD_TO_EARN_BY_CHECK_TASKS, checkBoxId, {
            timestamp: updateData.completed,
            rewardKey: buildTaskProgressRewardKey(task.id, updateData.completed, updateData.currentReviewerId),
            objectId: task.id,
            objectType: 'task',
        })
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

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    const sortIndex = generateSortIndex()

    const taskUpdateData = {
        ...updateData,
        ...(task.executionMode === TASK_EXECUTION_MODE_DIRECT ? { executionMode: TASK_EXECUTION_MODE_DIRECT } : {}),
        workflowAiPromptOverride: buildWorkflowAiPromptOverride(workflow, stepToMoveId, comment, transitionCommentId),
        done: stepToMoveId === DONE_STEP,
        inDone: stepToMoveId === DONE_STEP,
        sortIndex,
        estimations,
    }
    updateTaskData(projectId, task.id, taskUpdateData, batch)

    const taskChanges = [{ taskId: task.id, afterChanges: taskUpdateData }]
    if (parentId) {
        const promotionChanges = await promoteSubtaskToTask(projectId, task, batch)
        taskChanges[0].afterChanges = { ...taskUpdateData, ...promotionChanges }
        const parentChanges = getParentRemovalChanges(undoBeforeStates[parentId], task.id)
        if (parentChanges) taskChanges.push({ taskId: parentId, afterChanges: parentChanges })
    } else {
        const subtaskChanges = {
            ...updateData,
            parentDone: stepToMoveId === DONE_STEP,
            inDone: stepToMoveId === DONE_STEP,
        }
        updateSubtasksState(projectId, subtaskIds, subtaskChanges, batch)
        subtaskIds.forEach(taskId => taskChanges.push({ taskId, afterChanges: subtaskChanges }))
    }

    const undoAction = queueTaskTransitionUndo({
        projectId,
        task,
        stepToMoveId,
        beforeStates: undoBeforeStates,
        taskChanges,
        batch,
    })

    // AT-2193: every step change hands the task on, so it stops being the focus task — and it now
    // picks the next one like a postpone instead of leaving the user with no focus at all.
    const focusHandoff = beginWorkflowFocusHandoff(projectId, task, updateData.currentReviewerId)

    await batch.commit()

    if (stepToMoveId === DONE_STEP && !isDayRateTimeLogTask(task)) {
        await reconcileExistingDayRateTimeLog(projectId, userId, updateData.completed)
    }

    await finishWorkflowFocusHandoff(projectId, task, focusHandoff)

    moveTasksinWorkflowFeedsChain(projectId, task, stepToMoveId, workflow, estimations, undoAction?.actionId)
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

export async function moveTasksFromOpen(
    projectId,
    task,
    stepToMoveId,
    comment,
    commentType,
    estimations,
    checkBoxId,
    recurrenceBaseDateOverride = null
) {
    const { loggedUser } = store.getState()
    const loggedUserId = loggedUser.uid
    const completionDate = Date.now()
    const { parentId, subtaskIds = [], userId } = task
    const undoBeforeStates = await loadTaskUndoStates(projectId, [task.id, parentId, ...subtaskIds])

    // Completion/workflow-move comments must never trigger an assistant reply,
    // even when the task/thread has an assistant enabled — hence skipAssistantTrigger = true.
    const transitionCommentId = comment
        ? await createObjectMessage(projectId, task.id, comment, 'tasks', commentType, null, null, true)
        : null

    const ownerIsWorkstream = userId.startsWith(WORKSTREAM_ID_PREFIX)
    const newUserId = ownerIsWorkstream ? loggedUserId : userId

    let updateData
    let workflow = getUserWorkflow(projectId, newUserId, task)

    if (task.workflowTask && stepToMoveId === OPEN_STEP) {
        const firstWorkflowStepId = getWorkflowStepsIdsSorted(workflow)[0]
        if (!firstWorkflowStepId) return
        stepToMoveId = firstWorkflowStepId
    }
    if (task.workflowTask && task.stepHistory[task.stepHistory.length - 1] === stepToMoveId) return

    const completedTime = getTaskCompletedTime(task)

    if (stepToMoveId === DONE_STEP) {
        updateData = {
            userId: newUserId,
            userIds: [newUserId],
            currentReviewerId: DONE_STEP,
            completed: completionDate,
            completedTime,
            ...(task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
                ? { assigneeType: TASK_ASSIGNEE_ASSISTANT_TYPE, assistantId: task.assistantId }
                : {}),
        }
    } else {
        const { reviewerUid } = workflow[stepToMoveId]
        updateData = {
            userId: newUserId,
            userIds: [newUserId, reviewerUid],
            currentReviewerId: reviewerUid,
            completed: completionDate,
            stepHistory: task.workflowTask ? [...task.stepHistory, stepToMoveId] : [OPEN_STEP, stepToMoveId],
            completedTime,
        }
    }

    // Recurring task creation moved to cloud function (onUpdateTask)
    // This ensures reliable creation regardless of client state

    const ownerIsTeamMeber = !!TasksHelper.getUserInProject(projectId, task.userId)

    if (!task.parentId && ownerIsTeamMeber) {
        earnGold(projectId, newUserId, MAX_GOLD_TO_EARN_BY_CHECK_TASKS, checkBoxId, {
            timestamp: completionDate,
            rewardKey: buildTaskProgressRewardKey(task.id, completionDate, updateData.currentReviewerId),
            objectId: task.id,
            objectType: 'task',
        })
    }

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
        await setTaskAssignee(projectId, task.id, loggedUserId, wormstream, loggedUser, task, false, batch)
    }

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    const sortIndex = generateSortIndex()

    const taskUpdateData = {
        ...updateData,
        ...(task.suggestedBy ? { suggestedBy: null } : {}),
        ...(task.executionMode === TASK_EXECUTION_MODE_DIRECT ? { executionMode: TASK_EXECUTION_MODE_DIRECT } : {}),
        workflowAiPromptOverride: buildWorkflowAiPromptOverride(workflow, stepToMoveId, comment, transitionCommentId),
        ...(stepToMoveId === DONE_STEP && recurrenceBaseDateOverride ? { recurrenceBaseDateOverride } : {}),
        done: stepToMoveId === DONE_STEP,
        inDone: stepToMoveId === DONE_STEP,
        sortIndex,
        estimations,
    }
    updateTaskData(projectId, task.id, taskUpdateData, batch)

    const taskChanges = [{ taskId: task.id, afterChanges: taskUpdateData }]
    if (parentId) {
        const promotionChanges = await promoteSubtaskToTask(projectId, task, batch)
        taskChanges[0].afterChanges = { ...taskUpdateData, ...promotionChanges }
        const parentChanges = getParentRemovalChanges(undoBeforeStates[parentId], task.id)
        if (parentChanges) taskChanges.push({ taskId: parentId, afterChanges: parentChanges })
    } else {
        const subtaskChanges = {
            ...updateData,
            parentDone: stepToMoveId === DONE_STEP,
            inDone: stepToMoveId === DONE_STEP,
        }
        updateSubtasksState(projectId, subtaskIds, subtaskChanges, batch)
        subtaskIds.forEach(taskId => taskChanges.push({ taskId, afterChanges: subtaskChanges }))
    }

    const undoAction = queueTaskTransitionUndo({
        projectId,
        task,
        stepToMoveId,
        beforeStates: undoBeforeStates,
        taskChanges,
        batch,
    })

    // AT-2193: the task is leaving this user's plate, so it stops being their focus task exactly as
    // a postpone would. Captured before the commit so the optimistic swap lands without UI jumping.
    const focusHandoff = beginWorkflowFocusHandoff(projectId, task, updateData.currentReviewerId)

    await batch.commit()
    moveToTomorrowGoalReminderDateIfThereAreNotMoreTasks(projectId, task)

    if (stepToMoveId === DONE_STEP && ownerIsTeamMeber && !isDayRateTimeLogTask(task)) {
        await reconcileExistingDayRateTimeLog(projectId, newUserId, completionDate)
    }

    await updateLinkedContactsEditionData(projectId, task, completionDate)

    await finishWorkflowFocusHandoff(projectId, task, focusHandoff)

    moveTasksinWorkflowFeedsChain(projectId, task, stepToMoveId, workflow, estimations, undoAction?.actionId)
}

export async function moveTasksFromDone(projectId, task, stepToMoveId) {
    const { stepHistory, parentId, subtaskIds = [], userId, estimations } = task
    const undoBeforeStates = await loadTaskUndoStates(projectId, [task.id, parentId, ...subtaskIds])

    if (task.workflowTask && stepToMoveId === OPEN_STEP) {
        const firstWorkflowStepId = getWorkflowStepsIdsSorted(getUserWorkflow(projectId, task.userId, task))[0]
        if (!firstWorkflowStepId) return
        stepToMoveId = firstWorkflowStepId
    }

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
        workflow = getUserWorkflow(projectId, task.userId, task)
        const workflowStepsIds = getWorkflowStepsIdsSorted(workflow)

        const newUserIds = [task.userId]
        const newStepHistory = task.workflowTask ? [] : [OPEN_STEP]
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

    // AT-2259 - a calendar task orders by when it entered the list, exactly like every other task.
    // The event start lives in calendarData.start and is read from there where it is needed.
    const sortIndex = generateSortIndex()

    const taskUpdateData = {
        ...updateData,
        // Reopening a completed task has no transition-popup comment. Explicitly clear any old
        // handoff so landing on an AI step runs its configured prompt.
        workflowAiPromptOverride: null,
        done: false,
        inDone: false,
        sortIndex,
    }
    updateTaskData(projectId, task.id, taskUpdateData, batch)

    const taskChanges = [{ taskId: task.id, afterChanges: taskUpdateData }]
    if (parentId) {
        const promotionChanges = await promoteSubtaskToTask(projectId, task, batch)
        taskChanges[0].afterChanges = { ...taskUpdateData, ...promotionChanges }
        const parentChanges = getParentRemovalChanges(undoBeforeStates[parentId], task.id)
        if (parentChanges) taskChanges.push({ taskId: parentId, afterChanges: parentChanges })
    } else {
        const subtaskChanges = { ...updateData, parentDone: false, inDone: false }
        updateSubtasksState(projectId, subtaskIds, subtaskChanges, batch)
        subtaskIds.forEach(taskId => taskChanges.push({ taskId, afterChanges: subtaskChanges }))
    }

    const undoAction = queueTaskTransitionUndo({
        projectId,
        task,
        stepToMoveId,
        beforeStates: undoBeforeStates,
        taskChanges,
        batch,
    })

    // AT-2193: reopening a task into a step it did not previously sit on is a step change too, so
    // the same handoff applies. Reopening straight to Open hands it back to the owner, who is then
    // the incoming reviewer and therefore keeps it.
    const focusHandoff = beginWorkflowFocusHandoff(projectId, task, updateData.currentReviewerId)

    await batch.commit()

    if (ownerIsTeamMeber && !isDayRateTimeLogTask(task)) {
        await reconcileExistingDayRateTimeLog(projectId, userId, task.completed)
    }

    await finishWorkflowFocusHandoff(projectId, task, focusHandoff)

    moveTasksinWorkflowFeedsChain(projectId, task, stepToMoveId, workflow, task.estimations, undoAction?.actionId)
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
    newEstimation,
    recurrenceBaseDateOverride = null
) {
    const taskBatch = new BatchWrapper(getDb())
    const completedDate = isDone ? Date.now() : null
    const completed = isDone ? completedDate : firebase.firestore.FieldValue.delete()
    const shouldRecordUndo = createDoneFeed !== false
    const undoBeforeStates = shouldRecordUndo
        ? await loadTaskUndoStates(projectId, [taskId, ...(task.subtaskIds || [])])
        : {}

    const updateData = {
        done: isDone,
        inDone: task.parentId ? task.inDone : isDone,
        recurrence: task.recurrence,
        ...(isDone && recurrenceBaseDateOverride ? { recurrenceBaseDateOverride } : {}),
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

    let undoAction = null
    if (shouldRecordUndo) {
        const taskUndoChanges = { ...updateData }
        const taskAfterMissingFields = []
        if (!task.parentId) {
            if (isDone) taskUndoChanges.completed = completedDate
            else {
                delete taskUndoChanges.completed
                taskAfterMissingFields.push('completed')
            }
        }

        const taskChanges = [
            {
                taskId,
                afterChanges: taskUndoChanges,
                afterMissingFields: taskAfterMissingFields,
            },
        ]
        if (isDone) {
            const subtaskChanges = {
                completed: completedDate,
                parentDone: true,
                currentReviewerId: DONE_STEP,
                inDone: true,
            }
            task.subtaskIds.forEach(subtaskId => taskChanges.push({ taskId: subtaskId, afterChanges: subtaskChanges }))
        } else if (task.done) {
            const subtaskChanges = {
                parentDone: false,
                currentReviewerId: task.userId,
                inDone: false,
            }
            task.subtaskIds.forEach(subtaskId => taskChanges.push({ taskId: subtaskId, afterChanges: subtaskChanges }))
        }

        undoAction = queueTaskTransitionUndo({
            projectId,
            task,
            stepToMoveId: isDone ? DONE_STEP : OPEN_STEP,
            beforeStates: undoBeforeStates,
            taskChanges,
            batch: taskBatch,
        })
    }

    await taskBatch.commit()

    if (!isDayRateTimeLogTask(task)) {
        await reconcileExistingDayRateTimeLog(projectId, statisticUserUid, isDone ? completedDate : task.completed)
    }

    if (isDone && completedDate) {
        await updateLinkedContactsEditionData(projectId, task, completedDate)
    }

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

    // AT-2191: completing the focus task opens a handoff like a postpone does, so a postpone racing
    // with it cannot resurrect the completed task as the new focus.
    if (isDone && isFocusTaskForUser(projectId, taskId, taskOwnerUid)) {
        console.log(`[setTaskStatus] Calling findAndSetNewFocusedTask for workflow task`)
        await runFocusHandoff(startFocusHandoff(taskId), projectId, taskOwnerUid, task.parentGoalId, taskId)
    } else if (isDone) {
        console.log(`[setTaskStatus] NOT calling findAndSetNewFocusedTask - conditions not met`)
    }

    const feedBatch = new BatchWrapper(getDb())
    if (undoAction) feedBatch.currentUndoActionId = undoAction.actionId
    if (comment) {
        createObjectMessage(projectId, taskId, comment, 'tasks', STAYWARD_COMMENT, null, null)
    }

    if (isDone) {
        if (!task.parentId) {
            updateXpByDoneTask(statisticUserUid, task.estimations[OPEN_STEP], firebase, getDb(), projectId)
        }

        // Recurring task creation moved to cloud function (onUpdateTask)
        // This ensures reliable creation regardless of client state
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
        await batch.commit()
    }
    return updateData
}

export const updateSuggestedTask = (projectId, taskId, object) => {
    updateTaskData(projectId, taskId, object, null)
}

export const nextStepSuggestedTask = (projectId, targetStepId, task, estimations, comment, checkBoxId) => {
    const assistantRejection = getAssistantSuggestedTaskRejection(task)
    if (assistantRejection) {
        // moveTasksFromOpen persists `comment` as a normal visible user comment with assistant
        // triggering disabled. The weekly comment review can learn from it without a direct
        // user-memory write here.
        return moveTasksFromOpen(
            projectId,
            assistantRejection.task,
            assistantRejection.targetStepId,
            comment,
            assistantRejection.commentType,
            estimations,
            checkBoxId
        )
    }

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

export const getDateToMoveTaskInAutoPostpone = (timesPostponed, isObservedTask) => {
    let date = moment()

    if (!timesPostponed || isObservedTask) {
        date.add(3, 'days')
    } else if (timesPostponed === 1) {
        date.add(1, 'week')
    } else if (timesPostponed === 2) {
        date.add(1, 'month')
    } else if (timesPostponed === 3) {
        date.add(3, 'months')
    } else if (timesPostponed === 4) {
        date.add(6, 'months')
    } else if (timesPostponed === 5) {
        date.add(1, 'year')
    } else {
        date = BACKLOG_DATE_NUMERIC
    }
    return date
}

const getGoalsOrderingDataForProject = async (projectId, assigneeId) => {
    const { openMilestonesByProjectInTasks, doneMilestonesByProjectInTasks, goalsByProjectInTasks, loggedUser } =
        store.getState()

    const openMilestones = openMilestonesByProjectInTasks?.[projectId]
    const doneMilestones = doneMilestonesByProjectInTasks?.[projectId]
    const goalsById = goalsByProjectInTasks?.[projectId]

    if (openMilestones && doneMilestones && goalsById) {
        return { openMilestones, doneMilestones, goalsById, source: 'store' }
    }

    try {
        const ownerId = getOwnerId(projectId, assigneeId)
        const allowUserIds = loggedUser.isAnonymous ? [FEED_PUBLIC_FOR_ALL] : [FEED_PUBLIC_FOR_ALL, loggedUser.uid]

        const goalsSnapshot = await getDb()
            .collection(`goals/${projectId}/items`)
            .where('isPublicFor', 'array-contains-any', allowUserIds)
            .where('ownerId', '==', ownerId)
            .get()

        const goalsByIdFromFirestore = {}
        goalsSnapshot.forEach(doc => {
            goalsByIdFromFirestore[doc.id] = mapGoalData(doc.id, doc.data())
        })

        const milestonesSnapshot = await getDb()
            .collection(`goalsMilestones/${projectId}/milestonesItems`)
            .where('ownerId', '==', ownerId)
            .orderBy('date', 'asc')
            .get()

        const openMilestonesFromFirestore = []
        let doneMilestonesFromFirestore = []

        milestonesSnapshot.forEach(doc => {
            const milestone = mapMilestoneData(doc.id, doc.data())
            milestone.done ? doneMilestonesFromFirestore.push(milestone) : openMilestonesFromFirestore.push(milestone)
        })

        doneMilestonesFromFirestore = doneMilestonesFromFirestore
            .sort((a, b) => (a.doneDate || 0) - (b.doneDate || 0))
            .reverse()

        return {
            openMilestones: openMilestonesFromFirestore,
            doneMilestones: doneMilestonesFromFirestore,
            goalsById: goalsByIdFromFirestore,
            source: 'firestore',
        }
    } catch (error) {
        console.error('[getGoalsOrderingDataForProject] Failed to load goal ordering data', { projectId, error })
        return { openMilestones: [], doneMilestones: [], goalsById: null, source: 'none' }
    }
}

// Focus selection must match the task list's display order, which sorts tasks within each
// goal group by priority first (must_do > should_do > could_do > do_later > none) and then
// by sortIndex. Keeping this in sync avoids picking a lower-priority task as the next focus
// when a higher-priority one is visible above it.
const compareTasksByPriorityThenSortIndex = (a, b) => {
    const priorityDiff = getTaskPriorityRank(b.priority) - getTaskPriorityRank(a.priority)
    return priorityDiff !== 0 ? priorityDiff : (b.sortIndex || 0) - (a.sortIndex || 0)
}

const sortTasksByDisplayOrder = ({ projectId, assigneeId, tasks, openMilestones, doneMilestones, goalsById }) => {
    if (!tasks || tasks.length === 0) return []

    const tasksByGoalId = {}
    for (const task of tasks) {
        const goalId = task.parentGoalId ? task.parentGoalId : NOT_PARENT_GOAL_INDEX
        if (!tasksByGoalId[goalId]) tasksByGoalId[goalId] = []
        tasksByGoalId[goalId].push(task)
    }

    Object.keys(tasksByGoalId).forEach(goalId => {
        tasksByGoalId[goalId].sort(compareTasksByPriorityThenSortIndex)
    })

    const taskGroups = Object.keys(tasksByGoalId).map(goalId => [goalId, tasksByGoalId[goalId]])
    let goalsPositionId =
        openMilestones && doneMilestones && goalsById
            ? sortGoalTasksGorups(projectId, openMilestones, doneMilestones, goalsById, assigneeId, taskGroups)
            : null

    if (!goalsPositionId) {
        const goalIds = taskGroups.map(([goalId]) => goalId).filter(goalId => goalId !== NOT_PARENT_GOAL_INDEX)

        const sortedGoalIds = [...goalIds].sort((a, b) => {
            const aSort = tasksByGoalId[a]?.[0]?.sortIndex || 0
            const bSort = tasksByGoalId[b]?.[0]?.sortIndex || 0
            return bSort - aSort
        })

        goalsPositionId = {}
        sortedGoalIds.forEach((goalId, index) => {
            goalsPositionId[goalId] = index
        })
        goalsPositionId[NOT_PARENT_GOAL_INDEX] = sortedGoalIds.length
    }

    const generalTasks = []
    const validGroups = []
    taskGroups.forEach(([goalId, groupTasks]) => {
        if (goalsPositionId[goalId] === undefined) {
            generalTasks.push(...groupTasks)
        } else {
            validGroups.push([goalId, groupTasks])
        }
    })

    if (generalTasks.length > 0) {
        const existingGeneralIndex = validGroups.findIndex(([goalId]) => goalId === NOT_PARENT_GOAL_INDEX)
        if (existingGeneralIndex >= 0) {
            const mergedGeneralTasks = [...validGroups[existingGeneralIndex][1], ...generalTasks].sort(
                compareTasksByPriorityThenSortIndex
            )
            validGroups[existingGeneralIndex][1] = mergedGeneralTasks
        } else {
            validGroups.push([NOT_PARENT_GOAL_INDEX, [...generalTasks].sort(compareTasksByPriorityThenSortIndex)])
        }

        if (goalsPositionId[NOT_PARENT_GOAL_INDEX] === undefined) {
            goalsPositionId[NOT_PARENT_GOAL_INDEX] = Object.keys(goalsPositionId).length
        }
    }

    validGroups.sort((a, b) => {
        const aPos = goalsPositionId[a[0]] ?? Number.MAX_SAFE_INTEGER
        const bPos = goalsPositionId[b[0]] ?? Number.MAX_SAFE_INTEGER
        return aPos - bPos
    })

    const orderedTasks = []
    validGroups.forEach(([, groupTasks]) => {
        orderedTasks.push(...groupTasks)
    })

    return orderedTasks
}

const pickNextFocusTaskByDisplayOrder = async ({ projectId, userId, tasks }) => {
    if (!tasks || tasks.length === 0) return null

    const nonWorkflowTasks = tasks.filter(task => task.userIds?.length === 1)
    const workflowTasks = tasks.filter(task => !task.userIds || task.userIds.length !== 1)

    const { openMilestones, doneMilestones, goalsById, source } = await getGoalsOrderingDataForProject(
        projectId,
        userId
    )

    const orderedNonWorkflow = sortTasksByDisplayOrder({
        projectId,
        assigneeId: userId,
        tasks: nonWorkflowTasks,
        openMilestones,
        doneMilestones,
        goalsById,
    })

    if (orderedNonWorkflow.length > 0) {
        return orderedNonWorkflow[0]
    }

    if (workflowTasks.length === 0) return null

    const orderedWorkflow = sortTasksByDisplayOrder({
        projectId,
        assigneeId: userId,
        tasks: workflowTasks,
        openMilestones,
        doneMilestones,
        goalsById,
    })

    if (orderedWorkflow.length === 0) return null

    console.log('[pickNextFocusTaskByDisplayOrder] Fallback to workflow task ordering', {
        projectId,
        userId,
        goalsOrderingSource: source,
        workflowCount: workflowTasks.length,
    })

    return orderedWorkflow[0]
}

const pickPreferredFocusTaskInSameGoal = ({
    projectId,
    userId,
    tasks,
    preferredGoalId,
    openMilestones,
    doneMilestones,
    goalsById,
}) => {
    if (!preferredGoalId || !tasks || tasks.length === 0) return null

    const tasksInSameGoal = tasks.filter(task => task.parentGoalId === preferredGoalId)
    if (tasksInSameGoal.length === 0) return null

    const nonWorkflowTasksInSameGoal = tasksInSameGoal.filter(task => task.userIds?.length === 1)
    const candidateTasks = nonWorkflowTasksInSameGoal.length > 0 ? nonWorkflowTasksInSameGoal : tasksInSameGoal

    const orderedTasks = sortTasksByDisplayOrder({
        projectId,
        assigneeId: userId,
        tasks: candidateTasks,
        openMilestones,
        doneMilestones,
        goalsById,
    })

    return orderedTasks[0] || null
}

const pickNextGeneralFocusTask = ({ projectId, userId, tasks, openMilestones, doneMilestones, goalsById }) => {
    if (!tasks || tasks.length === 0) return null

    const generalTasks = tasks.filter(task => !task.parentGoalId)
    if (generalTasks.length === 0) return null

    const nonWorkflowGeneralTasks = generalTasks.filter(task => task.userIds?.length === 1)
    const candidateTasks = nonWorkflowGeneralTasks.length > 0 ? nonWorkflowGeneralTasks : generalTasks

    const orderedTasks = sortTasksByDisplayOrder({
        projectId,
        assigneeId: userId,
        tasks: candidateTasks,
        openMilestones,
        doneMilestones,
        goalsById,
    })

    return orderedTasks[0] || null
}

async function callAutoPostponeTasks(tasks, targetUserId, clearSelectedTasks, background) {
    if (!background) store.dispatch(startLoadingData())
    try {
        const sortedTasks = [...tasks].sort((a, b) => a.sortIndex - b.sortIndex)
        const taskRequests = sortedTasks.map(task => ({
            projectId: task.projectId,
            taskId: task.id,
            isObservedTask: !!task.isObservedTask,
        }))
        const result = { requestedCount: 0, updatedCount: 0, updated: [], skipped: [] }

        for (const taskChunk of chunk(taskRequests, 500)) {
            const chunkResult = await runHttpsCallableFunction('autoReminderTasksSecondGen', {
                targetUserId,
                tasks: taskChunk,
            })
            result.requestedCount += chunkResult.requestedCount || 0
            result.updatedCount += chunkResult.updatedCount || 0
            result.updated.push(...(chunkResult.updated || []))
            result.skipped.push(...(chunkResult.skipped || []))
        }

        if (clearSelectedTasks) store.dispatch(setSelectedTasks(null, true))
        return result
    } finally {
        if (!background) store.dispatch(stopLoadingData())
    }
}

export async function autoPostponeMultipleTasks(
    tasks,
    targetUserId = store.getState().currentUser.uid,
    { background = false } = {}
) {
    return callAutoPostponeTasks(tasks, targetUserId, true, background)
}

export async function autoPostponeTask(projectId, task, isObservedTask, targetUserId, { background = false } = {}) {
    const result = await callAutoPostponeTasks(
        [{ ...task, projectId, isObservedTask }],
        targetUserId || store.getState().currentUser.uid,
        false,
        background
    )
    return result.updated[0]?.dueDate ?? null
}

/**
 * AT-2251 — the imminent-calendar rule, mirrored for the optimistic pick.
 *
 * Both authoritative pickers run this phase FIRST and let it beat everything else: a meeting that
 * starts within the next 15 minutes becomes the focus task, and it is searched for across every
 * project rather than just the one the completed task lived in (findAndSetNewFocusedTask above,
 * and FocusTaskService's Phase 1 in the Cloud Function). The optimistic pick did the opposite — it
 * filtered calendar tasks out entirely and never left the current project — so completing a focus
 * task 10 minutes before a meeting showed an ordinary task and then visibly flipped to the meeting
 * a moment later. That flip is the same class of bug as the random pick this ticket started with:
 * two pickers, one answer expected.
 *
 * Scanning every project in `openTasksMap` is cheap because it is already in Redux. A project the
 * client has not loaded is invisible here, which is the one case that can still flip — the
 * authoritative pickers query Firestore directly and will find it.
 *
 * Returns `{ task, projectId }` because the winner may live in another project than the one that
 * just lost its focus task, and the optimistic slice is read per project.
 */
function pickImminentCalendarFocusTask({ openTasksMap, completedTask, focusUserId }) {
    const now = moment()
    const fifteenMinutesFromNow = moment().add(15, 'minutes')

    let earliest = null
    let earliestStart = null

    Object.keys(openTasksMap || {}).forEach(candidateProjectId => {
        Object.values(openTasksMap[candidateProjectId] || {}).forEach(task => {
            if (task.id === completedTask.id) return
            if (isFocusTaskReleased(task.id)) return
            if (task.done || task.isSubtask) return
            if (!isTaskOnUserPlate(task, focusUserId)) return

            const start = task.calendarData && task.calendarData.start
            if (!start) return

            const startDateTime = start.dateTime || start.date
            if (!startDateTime) return

            const taskStartTime = moment(startDateTime)
            if (!taskStartTime.isBetween(now, fifteenMinutesFromNow, undefined, '[)')) return
            if (earliestStart && !taskStartTime.isBefore(earliestStart)) return

            earliest = { task, projectId: candidateProjectId }
            earliestStart = taskStartTime
        })
    })

    return earliest
}

/**
 * Synchronously picks the next focus task from the Redux store using the same
 * display order as the UI (goals ordered by milestone + general tasks last).
 *
 * Returns `{ task, projectId }` (or null): an imminent calendar task can come from a different
 * project than the one whose focus task was just completed.
 */
function getOptimisticNextFocusTask(projectId, completedTask, focusUserId = completedTask.userId) {
    // `focusUserId` is the user whose focus task is being replaced (see setOptimisticNextFocusTask);
    // it is only the owner by coincidence in the common single-assignee case.
    const { openTasksMap, goalsByProjectInTasks, openMilestonesByProjectInTasks, doneMilestonesByProjectInTasks } =
        store.getState()

    // AT-2251: an imminent meeting outranks everything, exactly as in both authoritative pickers.
    const imminentCalendarTask = pickImminentCalendarFocusTask({ openTasksMap, completedTask, focusUserId })
    if (imminentCalendarTask) {
        console.log(`[getOptimisticNextFocusTask] Selected imminent calendar task:`, {
            id: imminentCalendarTask.task.id,
            name: imminentCalendarTask.task.name,
            projectId: imminentCalendarTask.projectId,
        })
        return imminentCalendarTask
    }

    const projectTasks = openTasksMap[projectId] || {}
    const goalsById = goalsByProjectInTasks[projectId] || null
    const openMilestones = openMilestonesByProjectInTasks[projectId] || []
    const doneMilestones = doneMilestonesByProjectInTasks[projectId] || []
    const endOfToday = moment().endOf('day').valueOf()

    console.log(`[getOptimisticNextFocusTask] Starting:`, {
        projectId,
        completedTaskId: completedTask.id,
        completedTaskGoalId: completedTask.parentGoalId,
        totalTasksInMap: Object.keys(projectTasks).length,
        goalsCount: goalsById ? Object.keys(goalsById).length : 0,
        milestonesCount: openMilestones.length,
    })

    // Get all candidate tasks due today; selection logic below still prefers non-workflow first.
    // AT-2191: isFocusTaskReleased skips tasks postponed earlier in the same burst — Redux still
    // shows them as due today until the Firestore listener catches up, so without it a rapid third
    // postpone can hand focus back to the task postponed first.
    // AT-2193: a task parked in another reviewer's workflow step is not this user's to work on, so
    // it can never be their focus task — the fallback below used to hand exactly those back.
    const candidateTasks = Object.values(projectTasks).filter(
        t =>
            t.id !== completedTask.id &&
            !isFocusTaskReleased(t.id) &&
            !t.done &&
            !t.isSubtask &&
            !t.calendarData &&
            t.dueDate <= endOfToday &&
            isTaskOnUserPlate(t, focusUserId)
    )

    console.log(`[getOptimisticNextFocusTask] Candidates after filtering:`, {
        count: candidateTasks.length,
        tasks: candidateTasks
            .slice(0, 5)
            .map(t => ({ id: t.id, name: t.name, goalId: t.parentGoalId, userIds: t.userIds?.length })),
    })

    if (candidateTasks.length === 0) return null

    const wasGeneralTask = !completedTask.parentGoalId

    if (wasGeneralTask) {
        const nextGeneralTask = pickNextGeneralFocusTask({
            projectId,
            userId: completedTask.userId,
            tasks: candidateTasks,
            openMilestones,
            doneMilestones,
            goalsById,
        })

        if (nextGeneralTask) {
            console.log(`[getOptimisticNextFocusTask] Selected general-task candidate:`, {
                id: nextGeneralTask.id,
                name: nextGeneralTask.name,
                goalId: nextGeneralTask.parentGoalId,
            })
            return { task: nextGeneralTask, projectId }
        }
    }

    const sameGoalTask = pickPreferredFocusTaskInSameGoal({
        projectId,
        userId: completedTask.userId,
        tasks: candidateTasks,
        preferredGoalId: completedTask.parentGoalId,
        openMilestones,
        doneMilestones,
        goalsById,
    })

    if (sameGoalTask) {
        console.log(`[getOptimisticNextFocusTask] Selected same-goal candidate:`, {
            id: sameGoalTask.id,
            name: sameGoalTask.name,
            goalId: sameGoalTask.parentGoalId,
        })
        return { task: sameGoalTask, projectId }
    }

    const nonWorkflowTasks = candidateTasks.filter(task => task.userIds?.length === 1)
    const workflowTasks = candidateTasks.filter(task => !task.userIds || task.userIds.length !== 1)

    const orderedTasks = sortTasksByDisplayOrder({
        projectId,
        assigneeId: completedTask.userId,
        tasks: nonWorkflowTasks.length > 0 ? nonWorkflowTasks : workflowTasks,
        openMilestones,
        doneMilestones,
        goalsById,
    })

    const result = orderedTasks[0] || null
    console.log(`[getOptimisticNextFocusTask] Selected by display order:`, {
        id: result?.id,
        name: result?.name,
        goalId: result?.parentGoalId,
    })
    return result ? { task: result, projectId } : null
}

/**
 * `focusUserId` is who the replacement is being chosen FOR. It is only the task's owner by
 * coincidence in the common single-assignee case: a reviewer handing a task on loses their OWN
 * focus, not the owner's. AT-2193 makes that distinction matter, because the candidate list is now
 * filtered by whether each task is still on that user's plate.
 */
function setOptimisticNextFocusTask(projectId, task, focusUserId = task.userId) {
    const optimisticNext = getOptimisticNextFocusTask(projectId, task, focusUserId)
    if (optimisticNext) {
        // The pick carries its own project: an imminent calendar task may live in another one.
        store.dispatch(
            setOptimisticFocusTask(
                optimisticNext.task.id,
                optimisticNext.projectId,
                optimisticNext.task.parentGoalId,
                focusUserId
            )
        )
    } else {
        store.dispatch(setOptimisticFocusTask(null, projectId, task.parentGoalId || NOT_PARENT_GOAL_INDEX, focusUserId))
    }
}

/**
 * AT-2191 — whether `taskId` is the focus task the user can currently see, which is the optimistic
 * pick whenever a swap is still in flight and the confirmed `users/{uid}.inFocusTaskId` otherwise.
 *
 * Reading only the confirmed value is what broke repeated postponing: it stays pointed at the FIRST
 * postponed task for a whole round trip, so the second postpone of a burst decided the task it was
 * postponing had never been in focus and skipped the swap.
 */
function isFocusTaskForUser(projectId, taskId, focusUserId) {
    const assignee = TasksHelper.getUserInProject(projectId, focusUserId)
    return isTaskHoldingFocus({
        taskId,
        projectId,
        focusUserId,
        confirmedFocusTaskId: assignee ? assignee.inFocusTaskId : null,
        optimisticFocus: readOptimisticFocus(store.getState()),
    })
}

/**
 * AT-2191 — runs the backend focus search for a handoff and settles it afterwards, so a burst of
 * postponements leaves exactly one winner. `startFocusHandoff` must already have been called (and
 * its id passed here) before the postpone was committed.
 */
async function runFocusHandoff(focusHandoffId, projectId, userId, previousTaskParentGoalId, excludeTaskId) {
    try {
        await findAndSetNewFocusedTask(projectId, userId, previousTaskParentGoalId, excludeTaskId, focusHandoffId)
    } finally {
        finishFocusHandoff(focusHandoffId)
    }
}

/**
 * AT-2193 — call BEFORE committing a workflow move. Decides whether the logged-in user loses their
 * focus task because of it and, if so, swaps the optimistic focus straight away so the task list
 * does not jump. Returns the user id to hand off after the commit, or null.
 *
 * Only the logged-in user is considered: firestore.rules forbids a client from writing another
 * user's doc, so a reviewer moving somebody else's focused task cannot clear the owner's focus from
 * here. The onUpdateTask trigger (functions/Tasks/workflowFocusHandoff.js) covers everyone else.
 */
function beginWorkflowFocusHandoff(projectId, task, incomingReviewerId) {
    const { loggedUser } = store.getState()
    const focusUserId = loggedUser ? loggedUser.uid : null
    const memberRecord = focusUserId ? TasksHelper.getUserInProject(projectId, focusUserId) : null

    // AT-2191: the optimistic pick is a third mirror of "what the user currently sees as focused",
    // and it is the only accurate one while an earlier swap is unconfirmed.
    const optimisticFocus = readOptimisticFocus(store.getState())
    const optimisticFocusTaskId =
        optimisticFocus.active &&
        (!optimisticFocus.projectId || optimisticFocus.projectId === projectId) &&
        (!optimisticFocus.userId || optimisticFocus.userId === focusUserId)
            ? optimisticFocus.taskId
            : null

    const shouldRelease = shouldReleaseFocusOnWorkflowMove({
        taskId: task.id,
        focusUserId,
        observedFocusTaskIds: [
            loggedUser ? loggedUser.inFocusTaskId : null,
            memberRecord?.inFocusTaskId,
            optimisticFocusTaskId,
        ],
        incomingReviewerId,
    })

    if (!shouldRelease) return null

    const handoffId = startFocusHandoff(task.id)
    // The replacement is chosen for the user who is LOSING focus, who is not necessarily the task's
    // owner — a reviewer handing the task on loses their own focus, not the owner's.
    setOptimisticNextFocusTask(projectId, task, focusUserId)
    return { focusUserId, handoffId }
}

/**
 * Postpone semantics (see setTaskDueDate): pick the user's next focus task instead of leaving them
 * with none. findAndSetNewFocusedTask clears the focus itself when it finds no replacement.
 */
async function finishWorkflowFocusHandoff(projectId, task, focusHandoff) {
    if (!focusHandoff || !focusHandoff.focusUserId) return
    await runFocusHandoff(focusHandoff.handoffId, projectId, focusHandoff.focusUserId, task.parentGoalId, task.id)
}

async function findAndSetNewFocusedTask(
    currentProjectId,
    userId,
    previousTaskParentGoalId = null,
    excludeTaskId = null,
    focusHandoffId = null
) {
    // AT-2191: every task released by the current burst, not just the one that triggered this
    // search. A Firestore query can still be served the pre-postpone state of the others.
    const excludedTaskIds = buildFocusCandidateExclusions(excludeTaskId)

    /**
     * AT-2191: a newer postpone has taken over. Bail out BEFORE writing — setNewFocusedTaskBatch
     * re-dates whatever it picks to `now`, so a late search would un-postpone a task the user has
     * already pushed away and steal the optimistic focus from the postpone that superseded it.
     */
    const isSuperseded = () => {
        if (!isFocusHandoffSuperseded(focusHandoffId)) return false
        console.log(`[findAndSetNewFocusedTask] Superseded by a newer focus handoff, skipping write`, {
            focusHandoffId,
            currentProjectId,
            excludeTaskId,
        })
        return true
    }

    console.log(
        `[findAndSetNewFocusedTask] Starting search for userId: ${userId}, projectId: ${currentProjectId}, previousTaskParentGoalId: ${previousTaskParentGoalId}, excludeTaskId: ${excludeTaskId}, excludedTaskIds: ${[
            ...excludedTaskIds,
        ].join(',')}`
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
                if (excludedTaskIds.has(task.id)) continue // AT-2191: never re-pick a just-released task
                // AT-2193: skip tasks already handed on to another reviewer's workflow step.
                if (!isTaskOnUserPlate(task, userId)) continue
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

    if (isSuperseded()) return false

    if (earliestUpcomingCalendarTask) {
        console.log(`[findAndSetNewFocusedTask] Found upcoming calendar task:`, {
            projectId: earliestUpcomingCalendarTaskProject,
            taskId: earliestUpcomingCalendarTask.id,
            taskName: earliestUpcomingCalendarTask.name,
        })
        return await setNewFocusedTaskBatch(
            earliestUpcomingCalendarTaskProject,
            userId,
            earliestUpcomingCalendarTask,
            focusHandoffId
        )
    }

    // --- If no upcoming calendar task, proceed with display-order prioritization ---
    const endOfToday = moment().endOf('day').valueOf() // endOfToday is still needed for non-calendar task logic below
    let newFocusedTask = null

    // --- Phase 1, 2 & 3: Try to find a task in the current project using display order ---
    const tasksRef = getDb().collection(`items/${currentProjectId}/tasks`)
    let query = tasksRef
        .where('userId', '==', userId)
        .where('done', '==', false)
        .where('inDone', '==', false)
        .where('isSubtask', '==', false)
        // dueDate and calendarData will be filtered in memory after fetching
        .orderBy('sortIndex', 'desc') // Primary sort

    try {
        const openTasksSnapshot = await query.limit(200).get() // Fetch a larger batch for in-memory filtering

        if (!openTasksSnapshot.empty) {
            const allTasksBeforeFilter = openTasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            const allFetchedTasksInCurrentProject = allTasksBeforeFilter.filter(
                task =>
                    task.dueDate <= endOfToday &&
                    !task.calendarData &&
                    !excludedTaskIds.has(task.id) &&
                    // AT-2193: the query matches on ownership, which still includes tasks this user
                    // has already handed on to the next workflow step's reviewer.
                    isTaskOnUserPlate(task, userId)
            )

            // Log filtering results for current project
            const filteredOutTasks = allTasksBeforeFilter.filter(
                task =>
                    task.dueDate > endOfToday ||
                    task.calendarData ||
                    excludedTaskIds.has(task.id) ||
                    !isTaskOnUserPlate(task, userId)
            )

            console.log(`[findAndSetNewFocusedTask] Current project ${currentProjectId} task analysis:`, {
                totalFetched: allTasksBeforeFilter.length,
                validTasksCount: allFetchedTasksInCurrentProject.length,
                filteredOutCount: filteredOutTasks.length,
                filteredOutReasons:
                    filteredOutTasks.length <= 10
                        ? filteredOutTasks.map(t => ({
                              id: t.id,
                              name: t.name,
                              dueDateFuture: t.dueDate > endOfToday,
                              dueDate: (() => {
                                  try {
                                      return new Date(t.dueDate).toISOString()
                                  } catch {
                                      return `invalid: ${t.dueDate}`
                                  }
                              })(),
                              isCalendarTask: !!t.calendarData,
                              isExcludedTask: excludedTaskIds.has(t.id),
                              parkedInOtherReviewersStep: !isTaskOnUserPlate(t, userId),
                          }))
                        : `${filteredOutTasks.length} tasks filtered (too many to log)`,
            })

            const { openMilestones, doneMilestones, goalsById, source } = await getGoalsOrderingDataForProject(
                currentProjectId,
                userId
            )

            const wasGeneralTask = !previousTaskParentGoalId
            const previousFocusProjectId = loggedUser.inFocusTaskProjectId || null
            const previousFocusWasInCurrentProject =
                !previousFocusProjectId || previousFocusProjectId === currentProjectId

            if (wasGeneralTask && previousFocusWasInCurrentProject) {
                newFocusedTask = pickNextGeneralFocusTask({
                    projectId: currentProjectId,
                    userId,
                    tasks: allFetchedTasksInCurrentProject,
                    openMilestones,
                    doneMilestones,
                    goalsById,
                })

                if (newFocusedTask) {
                    console.log(`[findAndSetNewFocusedTask] Found general focus task in current project:`, {
                        taskId: newFocusedTask.id,
                        taskName: newFocusedTask.name,
                        parentGoalId: newFocusedTask.parentGoalId,
                        goalsOrderingSource: source,
                    })
                }
            }

            if (!newFocusedTask) {
                newFocusedTask = pickPreferredFocusTaskInSameGoal({
                    projectId: currentProjectId,
                    userId,
                    tasks: allFetchedTasksInCurrentProject,
                    preferredGoalId: previousTaskParentGoalId,
                    openMilestones,
                    doneMilestones,
                    goalsById,
                })
            }

            if (newFocusedTask && !wasGeneralTask) {
                console.log(`[findAndSetNewFocusedTask] Found same-goal focus task in current project:`, {
                    taskId: newFocusedTask.id,
                    taskName: newFocusedTask.name,
                    parentGoalId: newFocusedTask.parentGoalId,
                    goalsOrderingSource: source,
                })
            }

            if (!newFocusedTask) {
                newFocusedTask = await pickNextFocusTaskByDisplayOrder({
                    projectId: currentProjectId,
                    userId,
                    tasks: allFetchedTasksInCurrentProject,
                })
            }
        } else {
            console.log(`[findAndSetNewFocusedTask] Current project ${currentProjectId}: No open tasks found for user`)
        }
    } catch (error) {
        console.error(`[findAndSetNewFocusedTask] Error querying current project ${currentProjectId}:`, error)
    }

    if (isSuperseded()) return false

    if (newFocusedTask) {
        console.log(`[findAndSetNewFocusedTask] Found new focus task in current project:`, {
            taskId: newFocusedTask.id,
            taskName: newFocusedTask.name,
            isWorkflowTask: newFocusedTask.userIds?.length > 1,
            parentGoalId: newFocusedTask.parentGoalId,
        })
        return await setNewFocusedTaskBatch(currentProjectId, userId, newFocusedTask, focusHandoffId)
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
    const projectsBeforeFilter = userProjects.map(pid => loggedUserProjects.find(p => p.id === pid))
    const projectsLostInFilter = userProjects.filter((pid, index) => !projectsBeforeFilter[index])

    if (projectsLostInFilter.length > 0) {
        console.warn(`[findAndSetNewFocusedTask] Projects in projectUsers but NOT in loggedUserProjects:`, {
            lostProjectIds: projectsLostInFilter,
            loggedUserProjectIds: loggedUserProjects.map(p => p.id),
        })
    }

    const sortedProjects = projectsBeforeFilter
        .filter(project => project) // Remove any undefined projects
        .sort((a, b) => {
            const aIndex = a.sortIndexByUser?.[userId] || 0
            const bIndex = b.sortIndexByUser?.[userId] || 0
            return bIndex - aIndex // Sort descending
        })
        .map(p => p.id)

    console.log(`[findAndSetNewFocusedTask] Phase 4: Searching other projects`, {
        currentProjectId,
        totalOtherProjects: sortedProjects.length,
        sortedProjectIds: sortedProjects,
        endOfToday: new Date(endOfToday).toISOString(),
    })

    // Search through each project in order of sortIndexByUser
    for (const pid of sortedProjects) {
        try {
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
                const allTasksFromProject = otherProjectTasks.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                const validTasks = allTasksFromProject.filter(
                    task =>
                        task.dueDate <= endOfToday &&
                        !task.calendarData &&
                        !excludedTaskIds.has(task.id) &&
                        // AT-2193: same rule as the current project.
                        isTaskOnUserPlate(task, userId)
                )

                // Log why tasks were filtered out
                const filteredOutTasks = allTasksFromProject.filter(
                    task =>
                        task.dueDate > endOfToday ||
                        task.calendarData ||
                        excludedTaskIds.has(task.id) ||
                        !isTaskOnUserPlate(task, userId)
                )

                console.log(`[findAndSetNewFocusedTask] Project ${pid} task analysis:`, {
                    totalFetched: allTasksFromProject.length,
                    validTasksCount: validTasks.length,
                    filteredOutCount: filteredOutTasks.length,
                    filteredOutReasons: filteredOutTasks.map(t => ({
                        id: t.id,
                        name: t.name,
                        dueDateFuture: t.dueDate > endOfToday,
                        dueDate: (() => {
                            try {
                                return new Date(t.dueDate).toISOString()
                            } catch {
                                return `invalid: ${t.dueDate}`
                            }
                        })(),
                        isCalendarTask: !!t.calendarData,
                        isExcludedTask: excludedTaskIds.has(t.id),
                    })),
                })

                if (validTasks.length > 0) {
                    const newFocusedTaskFromOtherProject = await pickNextFocusTaskByDisplayOrder({
                        projectId: pid,
                        userId,
                        tasks: validTasks,
                    })

                    if (newFocusedTaskFromOtherProject) {
                        if (isSuperseded()) return false
                        console.log(`[findAndSetNewFocusedTask] Found new focus task in other project:`, {
                            projectId: pid,
                            taskId: newFocusedTaskFromOtherProject.id,
                            taskName: newFocusedTaskFromOtherProject.name,
                            isWorkflowTask: newFocusedTaskFromOtherProject.userIds.length > 1,
                        })
                        return await setNewFocusedTaskBatch(pid, userId, newFocusedTaskFromOtherProject, focusHandoffId)
                    }
                }
            } else {
                console.log(`[findAndSetNewFocusedTask] Project ${pid}: No open tasks found for user`)
            }
        } catch (error) {
            console.error(`[findAndSetNewFocusedTask] Error querying project ${pid}:`, error)
        }
    }

    // If no tasks found in any project, clear the focus
    if (isSuperseded()) return false

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
                // AT-2259 - see updateFocusedTask: leaving focus never restores the calendar event
                // start, it hands the task an ordinary "just moved" sortIndex.
                batch.update(previouslyFocusedTaskRef, { sortIndex: generateSortIndex() })
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
    console.log(`[findAndSetNewFocusedTask] No new focus task found - clearing focus`, {
        searchedCurrentProject: currentProjectId,
        searchedOtherProjects: sortedProjects,
        totalProjectsSearched: 1 + sortedProjects.length,
        excludeTaskId,
        previousTaskParentGoalId,
    })

    // AT-2191: the optimistic pick predicted a replacement that the backend then failed to find, so
    // it now points at a task that is not focused and never will be. Neither this branch nor
    // clearConfirmedOptimisticFocus (which only fires when confirmed and optimistic AGREE, or when
    // both are empty) used to retire it, leaving optimisticFocusActive stuck on a stale task.
    // Fall back to "no focus" rather than clearing outright, so the list does not flash the task
    // that was just postponed while the users/{uid} snapshot is still in flight.
    if (store.getState().optimisticFocusActive && !isSuperseded()) {
        store.dispatch(
            setOptimisticFocusTask(null, currentProjectId, previousTaskParentGoalId || NOT_PARENT_GOAL_INDEX, userId)
        )
    }

    return false
}

// Helper function to set a new focused task with all necessary updates
async function setNewFocusedTaskBatch(projectId, userId, task, focusHandoffId = null) {
    // AT-2191: a newer postpone already owns the focus. Writing here would re-date this task to
    // `now` (the setTaskDueDate call below runs with fromSetTaskFocus=true), un-postponing a task
    // the user just pushed away, so bail out before anything is queued.
    if (isFocusHandoffSuperseded(focusHandoffId)) {
        console.log(`[setNewFocusedTaskBatch] Superseded by a newer focus handoff, skipping`, {
            taskId: task.id,
            focusHandoffId,
        })
        return false
    }

    const batch = new BatchWrapper(getDb())

    console.log(`[setNewFocusedTaskBatch] Setting new focus task:`, {
        taskId: task.id,
        taskName: task.name,
        projectId,
        goalId: task.parentGoalId,
        isWorkflow: task.userIds?.length > 1,
    })

    // Optimistically mark this task as the focus task BEFORE committing to Firestore
    // This prevents UI "jumping" by immediately showing the task at the top
    store.dispatch(setOptimisticFocusTask(task.id, projectId, task.parentGoalId, userId))

    // Generate the focus sortIndex
    const focusSortIndex = generateSortIndexForTaskInFocusInTime()

    // Set the new task as focused
    await setTaskDueDate(projectId, task.id, moment().valueOf(), task, false, batch, true)
    batch.update(getDb().doc(`items/${projectId}/tasks/${task.id}`), {
        sortIndex: focusSortIndex,
    })

    // Update user's focused task
    batch.update(getDb().doc(`users/${userId}`), {
        inFocusTaskId: task.id,
        inFocusTaskProjectId: projectId,
    })

    // AT-2191: re-checked because assembling the batch above awaits. A postpone that arrived in the
    // meantime has already dispatched its own optimistic pick, and this write would overwrite it.
    if (isFocusHandoffSuperseded(focusHandoffId)) {
        console.log(`[setNewFocusedTaskBatch] Superseded while preparing the batch, discarding it`, {
            taskId: task.id,
            focusHandoffId,
        })
        return false
    }

    // Commit all changes in one batch
    await batch.commit()

    // Clear the optimistic state now that Firestore has confirmed
    // (The Firestore listener will have updated the actual sortIndex by now)
    // AT-2191: unless a newer postpone has taken over in the meantime — the optimistic state is
    // then its pick, not ours, and clearing it would drop the user back onto a postponed task.
    if (isFocusHandoffSuperseded(focusHandoffId)) {
        console.log(`[setNewFocusedTaskBatch] Committed but superseded, leaving the optimistic state alone`)
    } else {
        console.log(`[setNewFocusedTaskBatch] Firestore confirmed, clearing optimistic state`)
        store.dispatch(clearOptimisticFocusTask())
    }

    // Create feed after successful update
    createTaskFocusChangedFeed(projectId, task.id, true, null, TasksHelper.getUserInProject(projectId, userId))
    return true
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
