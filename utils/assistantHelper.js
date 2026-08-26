import moment from 'moment'

import { FEED_PUBLIC_FOR_ALL } from '../components/Feeds/Utils/FeedsConstants'
import store from '../redux/store'
import { getDb, getId, getProjectUsersIds, getTaskData, runHttpsCallableFunction } from './backends/firestore'
import { getDateFormat } from '../components/UIComponents/FloatModals/DateFormatPickerModal'
import URLTrigger from '../URLSystem/URLTrigger'
import NavigationService from './NavigationService'
import {
    setAssistantEnabled,
    setDisableAutoFocusInChat,
    setSelectedNavItem,
    setTriggerBotSpinner,
    setPreConfigTaskExecuting,
    startLoadingData,
    stopLoadingData,
} from '../redux/actions'
import HelperFunctions from './HelperFunctions'
import ProjectHelper, { checkIfSelectedProject } from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../i18n/TranslationService'
import {
    getAssistantInProjectObject,
    getAssistantProjectId,
} from '../components/AdminPanel/Assistants/assistantsHelper'
import { moveTasksFromOpen, setTaskAssistant, uploadNewTask } from './backends/Tasks/tasksFirestore'
import { setNoteAssistant } from './backends/Notes/notesFirestore'
import { setGoalAssistant } from './backends/Goals/goalsFirestore'
import { setSkillAssistant } from './backends/Skills/skillsFirestore'
import TasksHelper, { DONE_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../components/TaskListView/Utils/TasksHelper'
import { DV_TAB_TASK_CHAT } from './TabNavigationConstants'
import { createChat } from './backends/Chats/chatsComments'
import { STAYWARD_COMMENT } from '../components/Feeds/Utils/HelperFunctions'
import { createObjectMessage } from './backends/Chats/chatsComments'
import { buildBotSpinnerTrigger } from '../components/ChatsView/Utils/botSpinnerTrigger'
import { buildAssistantEnabledScope } from '../components/ChatsView/Utils/assistantEnabledScope'
import { resolvePreConfigTaskReasoningEffort } from '../functions/Assistant/preConfigTaskReasoningEffort'
import { TASK_EXECUTION_MODE_DIRECT, TASK_EXECUTION_MODE_WORKFLOW, getTaskExecutionMode } from './taskExecutionMode'
import { ASSISTANT_WORKFLOW_FIRST_STEP_ID } from './assistantWorkflow'
import {
    buildOnDemandAssistantTaskMetadata,
    shouldUseClientTaskCompletionFallback,
} from '../functions/shared/assistantTaskCompletionContract'

export const CHAT_INPUT_LIMIT_IN_CHARACTERS = 10000

export const setObjectAssistantEnabled = async (projectId, objectId, objectType, isAssistantEnabled) => {
    if (!objectId || !objectType) return

    const normalizedObjectType =
        {
            task: 'tasks',
            chat: 'chats',
            topic: 'topics',
            note: 'notes',
            contact: 'contacts',
            user: 'users',
            skill: 'skills',
            goal: 'goals',
        }[objectType] || objectType

    let collectionPath = ''
    switch (normalizedObjectType) {
        case 'tasks':
            collectionPath = `items/${projectId}/tasks`
            break
        case 'chats':
        case 'topics':
            collectionPath = `chatObjects/${projectId}/chats`
            break
        case 'notes':
            collectionPath = `noteItems/${projectId}/notes`
            break
        case 'contacts':
            collectionPath = `contactsObjects/${projectId}/contacts`
            break
        case 'users':
        case 'assistants':
            collectionPath = `users`
            break
        case 'skills':
            collectionPath = `skillsObjects/${projectId}/skills`
            break
        case 'goals':
            collectionPath = `goals/${projectId}/items`
            break
        default:
            return
    }

    const docPath =
        normalizedObjectType === 'users' || normalizedObjectType === 'assistants'
            ? `${collectionPath}/${objectId}`
            : `${collectionPath}/${objectId}`
    try {
        await getDb().doc(docPath).update({ isAssistantEnabled })
    } catch (e) {
        console.error('Error setObjectAssistantEnabled:', e)
    }
}

export const generateUserIdsToNotifyForNewComments = (projectId, isPublicFor, creatorId) => {
    let userIds = getProjectUsersIds(projectId)
    if (!isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) userIds = userIds.filter(uid => isPublicFor.includes(uid))
    if (creatorId) userIds = userIds.filter(uid => uid !== creatorId)
    return userIds
}

export const createBotDailyTopic = async (projectId, summaryDate) => {
    console.log('Local part of createBotDailyTopic... there is also a cloud function which sets the follower')
    if (!projectId) return

    store.dispatch(startLoadingData())
    const { loggedUser, defaultAssistant } = store.getState()

    const chatId = `BotChat${moment().format('YYYYMMDD')}${loggedUser.uid}`

    const alreadyCreated = (await getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).get()).exists

    if (!alreadyCreated) {
        const isPublicFor = [FEED_PUBLIC_FOR_ALL]

        const title = `${translate('Daily Recap')} <> ${HelperFunctions.getFirstName(
            loggedUser.displayName
        )} ${moment().format(getDateFormat())}`

        await createChat(
            chatId,
            projectId,
            loggedUser.uid,
            '',
            'topics',
            title,
            isPublicFor,
            '#ffffff',
            null,
            null,
            '',
            '',
            STAYWARD_COMMENT,
            loggedUser.uid
        )

        const startDate = moment(summaryDate).startOf('day').valueOf()
        const endDate = moment(summaryDate).endOf('day').valueOf()
        const todayDate = new Date().toLocaleDateString('en-us', { month: 'long', day: 'numeric' })
        const lastSessionDate = new Date(summaryDate).toLocaleDateString('en-us', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        })

        await runHttpsCallableFunction('generateBotDailyTopicCommentSecondGen', {
            userId: loggedUser.uid,
            startDate,
            endDate,
            todayDate,
            lastSessionDate,
            objectId: chatId,
            userIdsToNotify: generateUserIdsToNotifyForNewComments(projectId, isPublicFor, ''),
            language: window.navigator.language,
            assistantId: defaultAssistant.uid,
        })
    }

    store.dispatch(stopLoadingData())
}

export const createBotQuickTopic = async (assistant, initialMessage = '', options = {}) => {
    store.dispatch(startLoadingData())
    const { loggedUser, selectedProjectIndex } = store.getState()

    const { enableAssistant = true, skipNavigation = false, projectId: customProjectId = null } = options

    try {
        const selectedProjectId = checkIfSelectedProject(selectedProjectIndex)
            ? ProjectHelper.getProjectByIndex(selectedProjectIndex).id
            : loggedUser.defaultProjectId
        const assistantProjectId =
            assistant && assistant.uid ? getAssistantProjectId(assistant.uid, selectedProjectId) : null
        const projectId = customProjectId || assistantProjectId || selectedProjectId || loggedUser.defaultProjectId

        if (!projectId) {
            store.dispatch(stopLoadingData())
            return
        }

        const chatId = getId()
        const quickDateId = moment().format('YYYYMMDD')

        const quickDateNumber =
            (await getDb().collection(`chatObjects/${projectId}/chats/`).where('quickDateId', '==', quickDateId).get())
                .docs.length + 1

        const isPublicFor = [FEED_PUBLIC_FOR_ALL]

        const title = `${assistant.displayName} <> ${HelperFunctions.getFirstName(
            loggedUser.displayName
        )} ${moment().format(getDateFormat())} ${quickDateNumber}`

        await createChat(
            chatId,
            projectId,
            loggedUser.uid,
            '',
            'topics',
            title,
            isPublicFor,
            '#ffffff',
            null,
            null,
            quickDateId,
            assistant.uid,
            STAYWARD_COMMENT,
            loggedUser.uid
        )

        // Enable assistant BEFORE creating the message so the trigger condition is met.
        // Scoped to the chat we just created: `createObjectMessage` below resolves the trigger
        // from the `isAssistantEnabled: true` we persist on the line above (`getParentObjectData`
        // returns this chat doc for 'topics'), so the Redux flag is UI state only. With
        // `skipNavigation` the user stays where they are, and an unscoped flag would follow them
        // into the next Chat DV they open (AT-2084).
        if (enableAssistant) {
            await getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).update({ isAssistantEnabled: true })
            store.dispatch(setAssistantEnabled(true, buildAssistantEnabledScope(projectId, chatId)))
            console.log('🔧 [createBotQuickTopic] Assistant enabled before message creation')
        }

        const trimmedMessage = typeof initialMessage === 'string' ? initialMessage.trim() : ''
        if (trimmedMessage) {
            await createObjectMessage(projectId, chatId, trimmedMessage, 'topics', null, null, null)
        }

        const postCreateActions = [stopLoadingData()]
        // Only arm the spinner when we actually take the user to this thread. With
        // `skipNavigation` nobody is watching this chat, and an unscoped trigger would be
        // picked up by whatever Chat DV the user opens next (AT-2084).
        if (enableAssistant && trimmedMessage && !skipNavigation) {
            postCreateActions.push(setTriggerBotSpinner(buildBotSpinnerTrigger(projectId, chatId)))
        }
        store.dispatch(postCreateActions)

        if (!skipNavigation) {
            const url = `/projects/${projectId}/chats/${chatId}/chat`
            URLTrigger.processUrl(NavigationService, url)
        }

        return {
            projectId,
            chatId,
            assistantId: assistant.uid,
            isPublicFor,
            title,
        }
    } catch (error) {
        console.error('Error creating bot quick topic:', error)
        store.dispatch(stopLoadingData())
        throw error
    }
}

const createTopicForPreConfigTask = async (
    projectId,
    taskId,
    isPublicFor,
    assistantId,
    prompt,
    aiSettings,
    taskMetadata
) => {
    const { loggedUser } = store.getState()

    console.log('Creating topic for pre-config task:', {
        taskId,
        assistantId,
        aiSettings,
        taskMetadata,
    })

    try {
        // Fetch the task data to get the task name
        const task = await getTaskData(projectId, taskId)
        if (!task) {
            throw new Error(`Task not found: ${taskId}`)
        }

        console.log('Retrieved task data:', {
            taskId,
            taskName: task.extendedName,
        })

        // Check if the chat already exists
        const chatExists = (await getDb().doc(`chatObjects/${projectId}/chats/${taskId}`).get()).exists

        if (!chatExists) {
            console.log('Creating chat object for pre-config task:', {
                taskId,
                taskName: task.extendedName,
                objectType: 'tasks',
            })

            // Create the chat object before calling the backend
            // This ensures the chat exists when storeBotAnswerStream tries to fetch it
            await createChat(
                taskId,
                projectId,
                loggedUser.uid,
                '',
                'tasks',
                task.extendedName,
                isPublicFor,
                '#ffffff',
                null,
                [loggedUser.uid], // followerIds - include the user who triggered the task
                '',
                assistantId,
                STAYWARD_COMMENT,
                loggedUser.uid // parentObjectCreatorId
            )
            console.log('Chat object created successfully for task:', taskId)
        } else {
            console.log('Chat already exists for task:', taskId)
        }

        // Explicitly enable the assistant on this thread now, including reruns on existing task chats.
        await getDb().doc(`chatObjects/${projectId}/chats/${taskId}`).update({ isAssistantEnabled: true })

        // Create user message with the prompt in the frontend so it appears immediately
        // Pass skipAssistantTrigger=true to avoid double triggering (we trigger it explicitly below)
        let messageId = null
        if (prompt && prompt.trim()) {
            console.log('Creating user message with prompt for task:', taskId)
            messageId = await createObjectMessage(
                projectId,
                taskId,
                prompt.trim(),
                'tasks',
                STAYWARD_COMMENT,
                null,
                null,
                true
            )
        }

        // Clear the executing state after topic and message are created
        store.dispatch(setPreConfigTaskExecuting(null))

        const functionParams = {
            userId: loggedUser.uid,
            projectId,
            taskId,
            userIdsToNotify: generateUserIdsToNotifyForNewComments(projectId, isPublicFor, ''),
            isPublicFor,
            assistantId,
            prompt,
            language: window.navigator.language,
            aiSettings,
            taskMetadata,
            messageId,
        }

        const clientSubmissionTime = Date.now()
        const clientSubmissionTimestamp = new Date().toISOString()
        if (__DEV__) {
            console.log('⏱️ [TIMING] CLIENT: Pre-config task submitted, calling generatePreConfigTaskResultSecondGen', {
                timestamp: clientSubmissionTimestamp,
                submissionTime: clientSubmissionTime,
                submissionTimeISO: clientSubmissionTimestamp,
                userId: loggedUser.uid,
                projectId,
                taskId,
                assistantId,
                promptLength: prompt?.length,
            })
        }
        console.log('Calling generatePreConfigTaskResultSecondGen with params:', functionParams)

        try {
            const functionCallStartTime = Date.now()
            const result = await runHttpsCallableFunction('generatePreConfigTaskResultSecondGen', functionParams, {
                timeout: 540000, // 9 minutes (540 seconds) to match backend timeout
            })
            const clientCallCompleteTime = Date.now()
            const totalClientToServerTime = clientCallCompleteTime - clientSubmissionTime
            const networkLatency = functionCallStartTime - clientSubmissionTime

            if (__DEV__) {
                console.log('⏱️ [TIMING] CLIENT: generatePreConfigTaskResultSecondGen completed', {
                    timestamp: new Date().toISOString(),
                    submissionTime: clientSubmissionTime,
                    submissionTimeISO: clientSubmissionTimestamp,
                    completionTime: clientCallCompleteTime,
                    completionTimeISO: new Date().toISOString(),
                    timeSinceSubmission: `${totalClientToServerTime}ms`,
                    networkLatency: `${networkLatency}ms`,
                    backendProcessingTime: `${totalClientToServerTime - networkLatency}ms`,
                })
            }
            console.log('Successfully completed generatePreConfigTaskResultSecondGen')
            return result
        } catch (error) {
            console.error('Error in generatePreConfigTaskResultSecondGen:', {
                error,
                errorMessage: error.message,
                errorCode: error.code,
                functionParams,
            })
            // Re-throw to maintain existing error handling behavior
            throw error
        }
    } catch (error) {
        console.error('Error in createTopicForPreConfigTask:', {
            error,
            errorMessage: error.message,
            projectId,
            taskId,
            assistantId,
        })
        // Clear the executing state on error
        store.dispatch(setPreConfigTaskExecuting(null))
        throw error
    }
}

const activePreConfigPromptTaskExecutions = new Set()

const resolvePreConfigAiSettings = (projectId, assistantId, aiSettings) => {
    const assistantDetails = getAssistantInProjectObject(projectId, assistantId)
    if (!aiSettings && !assistantDetails) return null

    const overrides = aiSettings || {}
    return {
        ...overrides,
        model: overrides.model || assistantDetails?.model,
        temperature: overrides.temperature || assistantDetails?.temperature,
        reasoningEffort: resolvePreConfigTaskReasoningEffort(
            { aiReasoningEffort: overrides.reasoningEffort },
            assistantDetails?.reasoningEffort
        ),
        systemMessage: overrides.systemMessage || assistantDetails?.instructions,
        assistantUid: overrides.assistantUid || assistantDetails?.uid || assistantId,
        assistantDisplayName:
            overrides.assistantDisplayName || assistantDetails?.displayName || assistantDetails?.name || '',
        allowedTools: Array.isArray(overrides.allowedTools)
            ? overrides.allowedTools
            : Array.isArray(assistantDetails?.allowedTools)
              ? assistantDetails.allowedTools
              : [],
    }
}

export const executePreConfigPromptForTask = ({
    projectId,
    taskId,
    task,
    assistantId,
    prompt,
    name,
    aiSettings,
    taskMetadata = null,
}) => {
    const executionKey = `${projectId}:${taskId}`
    if (activePreConfigPromptTaskExecutions.has(executionKey)) return Promise.resolve(false)

    activePreConfigPromptTaskExecutions.add(executionKey)
    store.dispatch(setPreConfigTaskExecuting(name))

    const resolvedAiSettings = resolvePreConfigAiSettings(projectId, assistantId, aiSettings)
    const isPublicFor = task?.isPublicFor || [FEED_PUBLIC_FOR_ALL]
    const mergedTaskMetadata = {
        ...(taskMetadata || {}),
        name: task?.name || name,
        recurrence: task?.recurrence,
    }

    return Promise.resolve()
        .then(async () => {
            await Promise.all([
                task?.assistantId !== assistantId
                    ? setTaskAssistant(projectId, taskId, assistantId, !!task?.assistantId)
                    : Promise.resolve(),
                setObjectAssistantEnabled(projectId, taskId, 'tasks', true),
            ])

            return await createTopicForPreConfigTask(
                projectId,
                taskId,
                isPublicFor,
                assistantId,
                prompt,
                resolvedAiSettings,
                mergedTaskMetadata
            )
        })
        .catch(error => {
            console.error('Failed to execute pre-config prompt for current task:', error)
            return false
        })
        .finally(() => {
            activePreConfigPromptTaskExecutions.delete(executionKey)
            store.dispatch(setPreConfigTaskExecuting(null))
        })
}

export const generateTaskFromPreConfig = async (
    projectId,
    name,
    assistantId,
    generatedPrompt,
    aiSettings,
    taskMetadata = null,
    options = {}
) => {
    const { skipNavigation = false, waitForDirectRun = true } = options
    const resolvedAiSettings = resolvePreConfigAiSettings(projectId, assistantId, aiSettings)
    // Preconfigured prompts created before execution modes existed always ran directly.
    const executionMode = getTaskExecutionMode(taskMetadata, TASK_EXECUTION_MODE_DIRECT)
    const effectiveTaskMetadata =
        executionMode === TASK_EXECUTION_MODE_DIRECT ? buildOnDemandAssistantTaskMetadata(taskMetadata) : taskMetadata
    const { loggedUser } = store.getState()

    console.log('generateTaskFromPreConfig called:', {
        projectId,
        name,
        assistantId,
        aiSettings: resolvedAiSettings,
        taskMetadata: effectiveTaskMetadata,
        skipNavigation,
    })

    const generatedTask = TasksHelper.getNewDefaultTask()
    generatedTask.extendedName = name.trim()
    generatedTask.name = TasksHelper.getTaskNameWithoutMeta(generatedTask.extendedName)
    generatedTask.userId = assistantId
    generatedTask.userIds = [assistantId]
    generatedTask.currentReviewerId = assistantId
    generatedTask.assigneeType = TASK_ASSIGNEE_ASSISTANT_TYPE
    generatedTask.assistantId = assistantId
    generatedTask.isPublicFor = [FEED_PUBLIC_FOR_ALL]
    generatedTask.executionMode = executionMode
    generatedTask.isAssistantEnabled = executionMode === TASK_EXECUTION_MODE_DIRECT

    if (executionMode === TASK_EXECUTION_MODE_WORKFLOW) {
        const now = Date.now()
        generatedTask.workflowTask = true
        generatedTask.workflowPayerUserId = loggedUser.uid
        generatedTask.stepHistory = [ASSISTANT_WORKFLOW_FIRST_STEP_ID]
        generatedTask.currentReviewerId = assistantId
        generatedTask.completed = now
        generatedTask.dueDate = now
        generatedTask.estimations = {
            ...generatedTask.estimations,
            [ASSISTANT_WORKFLOW_FIRST_STEP_ID]: 0,
        }
        generatedTask.workflowAiPromptOverride = {
            stepId: ASSISTANT_WORKFLOW_FIRST_STEP_ID,
            prompt: generatedPrompt,
        }
    }

    // Add AI settings to the task if provided
    if (resolvedAiSettings) {
        generatedTask.aiModel = resolvedAiSettings.model
        generatedTask.aiTemperature = resolvedAiSettings.temperature
        generatedTask.aiReasoningEffort = resolvedAiSettings.reasoningEffort
        generatedTask.aiSystemMessage = resolvedAiSettings.systemMessage
    }

    // Persist completion provenance with direct generated tasks so the callable can safely
    // distinguish them from existing tasks that merely run an assistant prompt.
    if (effectiveTaskMetadata) {
        generatedTask.taskMetadata = effectiveTaskMetadata
    }

    console.log('Creating task with settings:', {
        taskName: generatedTask.name,
        aiSettings: {
            model: generatedTask.aiModel,
            temperature: generatedTask.aiTemperature,
            reasoningEffort: generatedTask.aiReasoningEffort,
            systemMessage: generatedTask.aiSystemMessage,
        },
        taskMetadata: effectiveTaskMetadata,
    })

    const task = await uploadNewTask(projectId, generatedTask, null, true, false, false, false)
    const taskWithPublicFor = {
        ...task,
        isPublicFor: task.isPublicFor || [FEED_PUBLIC_FOR_ALL],
        isAssistantEnabled: executionMode === TASK_EXECUTION_MODE_DIRECT,
    }

    if (executionMode === TASK_EXECUTION_MODE_DIRECT) {
        // Purely UI state for the task chat we are about to open: the assistant run itself is
        // triggered from the task's persisted `isAssistantEnabled: true` (and
        // `createTopicForPreConfigTask` calls `createObjectMessage` with skipAssistantTrigger,
        // dispatching `generatePreConfigTaskResultSecondGen` explicitly). Scoping it to this task
        // keeps the navigating case identical while stopping a `skipNavigation: true` run — the
        // My Day assistant line and the pre-config task search modal — from switching the
        // assistant on in whatever unrelated chat the user opens next (AT-2084).
        store.dispatch(setAssistantEnabled(true, buildAssistantEnabledScope(projectId, task.id)))

        console.log('Creating topic for task:', {
            taskId: taskWithPublicFor.id,
            isPublicFor: taskWithPublicFor.isPublicFor,
            assistantId: taskWithPublicFor.assistantId,
            aiSettings: resolvedAiSettings,
            taskMetadata: effectiveTaskMetadata,
            taskWithPublicForSendWhatsApp: taskWithPublicFor.sendWhatsApp,
            taskWithPublicForTaskMetadata: taskWithPublicFor.taskMetadata,
        })

        // Merge provided taskMetadata with task-specific metadata
        const mergedMetadata = {
            ...(effectiveTaskMetadata || {}),
            sendWhatsApp: taskWithPublicFor.sendWhatsApp ?? effectiveTaskMetadata?.sendWhatsApp,
            name: taskWithPublicFor.name,
            recurrence: taskWithPublicFor.recurrence,
        }

        console.log('Merged metadata for backend:', {
            mergedMetadata,
            taskMetadataInput: effectiveTaskMetadata,
            taskSendWhatsApp: taskWithPublicFor.sendWhatsApp,
            taskMetadataSendWhatsApp: effectiveTaskMetadata?.sendWhatsApp,
            taskTaskMetadataSendWhatsApp: taskWithPublicFor.taskMetadata?.sendWhatsApp,
        })

        if (!skipNavigation) {
            // Trigger the bot spinner to show assistant is working (without toggling
            // assistantEnabled), scoped to the task chat we are about to open. When we do not
            // navigate there is no chat to show it in, and an unscoped trigger would surface
            // in an unrelated Chat DV instead (AT-2084).
            store.dispatch(setTriggerBotSpinner(buildBotSpinnerTrigger(projectId, taskWithPublicFor.id)))

            NavigationService.navigate('TaskDetailedView', {
                task: taskWithPublicFor,
                projectId: projectId,
            })

            store.dispatch([setSelectedNavItem(DV_TAB_TASK_CHAT), setDisableAutoFocusInChat(true)])
        }

        if (effectiveTaskMetadata?.isWebhookTask) {
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        const runAndCompleteDirectTask = async () => {
            const executionResult = await executePreConfigPromptForTask({
                projectId,
                taskId: taskWithPublicFor.id,
                task: taskWithPublicFor,
                assistantId: taskWithPublicFor.assistantId,
                prompt: generatedPrompt,
                name,
                aiSettings: resolvedAiSettings,
                taskMetadata: mergedMetadata,
            })

            // Old Functions deployments do not return taskCompletion, while a transient server
            // completion failure can still be recovered by the live client. The server is the
            // authoritative owner once it reports success, avoiding duplicate completion writes.
            if (executionResult && shouldUseClientTaskCompletionFallback(executionResult.taskCompletion)) {
                await moveTasksFromOpen(
                    projectId,
                    taskWithPublicFor,
                    DONE_STEP,
                    null,
                    null,
                    taskWithPublicFor.estimations,
                    null
                )
            }
        }

        if (waitForDirectRun) {
            await runAndCompleteDirectTask()
        } else {
            runAndCompleteDirectTask().catch(error => {
                console.error('Could not finish direct assistant task in the background:', error)
            })
        }
    } else if (!skipNavigation) {
        NavigationService.navigate('TaskDetailedView', {
            task: taskWithPublicFor,
            projectId,
        })
        store.dispatch([setSelectedNavItem(DV_TAB_TASK_CHAT), setDisableAutoFocusInChat(true)])
    }

    return taskWithPublicFor
}
