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
    startLoadingData,
    stopLoadingData,
} from '../redux/actions'
import HelperFunctions from './HelperFunctions'
import ProjectHelper, { checkIfSelectedProject } from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import { translate } from '../i18n/TranslationService'
import { getAssistantInProjectObject } from '../components/AdminPanel/Assistants/assistantsHelper'
import { moveTasksFromOpen, setTaskAssistant, uploadNewTask } from './backends/Tasks/tasksFirestore'
import { setNoteAssistant } from './backends/Notes/notesFirestore'
import { setGoalAssistant } from './backends/Goals/goalsFirestore'
import { setSkillAssistant } from './backends/Skills/skillsFirestore'
import TasksHelper, { DONE_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../components/TaskListView/Utils/TasksHelper'
import { DV_TAB_TASK_CHAT } from './TabNavigationConstants'
import { createChat } from './backends/Chats/chatsComments'
import { STAYWARD_COMMENT } from '../components/Feeds/Utils/HelperFunctions'
import { createObjectMessage } from './backends/Chats/chatsComments'

export const CHAT_INPUT_LIMIT_IN_CHARACTERS = 10000

export const generateUserIdsToNotifyForNewComments = (projectId, isPublicFor, creatorId) => {
    let userIds = getProjectUsersIds(projectId)
    if (!isPublicFor.includes(FEED_PUBLIC_FOR_ALL)) userIds = userIds.filter(uid => isPublicFor.includes(uid))
    if (creatorId) userIds = userIds.filter(uid => uid !== creatorId)
    return userIds
}

const checkIfBotNeedToGenerateAdvaice = projectId => {
    const { botAdvaiceTriggerPercent } = store.getState().loggedUser
    const project = ProjectHelper.getProjectById(projectId)
    if (project && project.isTemplate) return false
    if (!botAdvaiceTriggerPercent) return false
    const ADVAICE_POSSIBILITY = botAdvaiceTriggerPercent / 100
    return Math.random() < ADVAICE_POSSIBILITY
}

export const tryToGenerateTopicAdvaice = async (
    projectId,
    objectId,
    objectType,
    isPublicFor,
    objectName,
    followerIds,
    assistantId,
    parentObjectCreatorId
) => {
    const needToGenerateAdvaice = checkIfBotNeedToGenerateAdvaice(projectId)

    if (needToGenerateAdvaice) {
        const { loggedUser } = store.getState()

        const assistant = getAssistantInProjectObject(projectId, assistantId)

        await createChat(
            objectId,
            projectId,
            loggedUser.uid,
            '',
            objectType,
            objectName,
            isPublicFor,
            '#ffffff',
            null,
            followerIds,
            '',
            assistant.uid,
            STAYWARD_COMMENT,
            parentObjectCreatorId
        )

        if (assistantId !== assistant.uid) {
            switch (objectType) {
                case 'tasks':
                    setTaskAssistant(projectId, objectId, assistant.uid, false)
                    break
                case 'notes':
                    setNoteAssistant(projectId, objectId, assistant.uid, false)
                    break
                case 'goals':
                    setGoalAssistant(projectId, objectId, assistant.uid, false)
                    break
                case 'skills':
                    setSkillAssistant(projectId, objectId, assistant.uid, false)
                    break
            }
        }

        await runHttpsCallableFunction('generateBotAdvaiceSecondGen', {
            projectId,
            objectId,
            objectType,
            userIdsToNotify: generateUserIdsToNotifyForNewComments(projectId, isPublicFor, ''),
            topicName: objectName,
            language: window.navigator.language,
            isPublicFor,
            assistantId: assistant.uid,
            followerIds,
            userId: loggedUser.uid,
        })
    }
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

    const { enableAssistant = true } = options

    try {
        const projectId = checkIfSelectedProject(selectedProjectIndex)
            ? ProjectHelper.getProjectByIndex(selectedProjectIndex).id
            : loggedUser.defaultProjectId

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

        const trimmedMessage = typeof initialMessage === 'string' ? initialMessage.trim() : ''
        if (trimmedMessage) {
            await createObjectMessage(projectId, chatId, trimmedMessage, 'topics', null, null, null)
        }

        const postCreateActions = [stopLoadingData(), setAssistantEnabled(enableAssistant)]
        if (enableAssistant && trimmedMessage) {
            postCreateActions.push(setTriggerBotSpinner(true))
        }
        store.dispatch(postCreateActions)

        const url = `/projects/${projectId}/chats/${chatId}/chat`
        URLTrigger.processUrl(NavigationService, url)

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
        }

        console.log('Calling generatePreConfigTaskResultSecondGen with params:', functionParams)

        try {
            await runHttpsCallableFunction('generatePreConfigTaskResultSecondGen', functionParams, {
                timeout: 540000, // 9 minutes (540 seconds) to match backend timeout
            })
            console.log('Successfully completed generatePreConfigTaskResultSecondGen')
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
        throw error
    }
}

export const generateTaskFromPreConfig = async (
    projectId,
    name,
    assistantId,
    generatedPrompt,
    aiSettings,
    taskMetadata = null
) => {
    console.log('generateTaskFromPreConfig called:', {
        projectId,
        name,
        assistantId,
        aiSettings,
        taskMetadata,
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

    // Add AI settings to the task if provided
    if (aiSettings) {
        generatedTask.aiModel = aiSettings.model
        generatedTask.aiTemperature = aiSettings.temperature
        generatedTask.aiSystemMessage = aiSettings.systemMessage
    }

    // Add taskMetadata to the task if provided (for webhook tasks)
    if (taskMetadata) {
        generatedTask.taskMetadata = taskMetadata
    }

    console.log('Creating task with settings:', {
        taskName: generatedTask.name,
        aiSettings: {
            model: generatedTask.aiModel,
            temperature: generatedTask.aiTemperature,
            systemMessage: generatedTask.aiSystemMessage,
        },
        taskMetadata,
    })

    uploadNewTask(projectId, generatedTask, null, true, false, false, false).then(task => {
        // Ensure task has isPublicFor set
        const taskWithPublicFor = {
            ...task,
            isPublicFor: task.isPublicFor || [FEED_PUBLIC_FOR_ALL],
        }

        console.log('Creating topic for task:', {
            taskId: taskWithPublicFor.id,
            isPublicFor: taskWithPublicFor.isPublicFor,
            assistantId: taskWithPublicFor.assistantId,
            aiSettings,
            taskMetadata,
        })

        // Merge provided taskMetadata with task-specific metadata
        const mergedMetadata = {
            sendWhatsApp: taskWithPublicFor.sendWhatsApp,
            name: taskWithPublicFor.name,
            recurrence: taskWithPublicFor.recurrence,
            ...(taskMetadata || {}),
        }

        // Add a small delay for webhook tasks to avoid race condition with frontend updates
        const isWebhookTask = taskMetadata?.isWebhookTask
        const delay = isWebhookTask ? 1000 : 0

        setTimeout(() => {
            createTopicForPreConfigTask(
                projectId,
                taskWithPublicFor.id,
                taskWithPublicFor.isPublicFor,
                taskWithPublicFor.assistantId,
                generatedPrompt,
                aiSettings,
                mergedMetadata
            ).catch(error => {
                console.error('Failed to create topic for pre-config task:', error)
            })
        }, delay)

        NavigationService.navigate('TaskDetailedView', {
            task: taskWithPublicFor,
            projectId: projectId,
        })

        store.dispatch([
            setSelectedNavItem(DV_TAB_TASK_CHAT),
            setTriggerBotSpinner(true),
            setDisableAutoFocusInChat(true),
        ])

        moveTasksFromOpen(projectId, taskWithPublicFor, DONE_STEP, null, null, taskWithPublicFor.estimations, null)
    })
}
