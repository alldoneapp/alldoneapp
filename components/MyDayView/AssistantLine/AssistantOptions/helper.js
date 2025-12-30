import { translate } from '../../../../i18n/TranslationService'
import { TASK_TYPE_PROMPT, TASK_TYPE_IFRAME } from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import {
    getAssistant,
    getAssistantInProject,
    getAssistantProjectId,
} from '../../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper, { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import store from '../../../../redux/store'
import { setPreConfigTaskExecuting } from '../../../../redux/actions'

export const TASK_OPTION = 'TASK_OPTION'

const getOptions = (project, assistantId, tasks, selectedProjectId) => {
    return tasks.map(task => {
        return {
            id: task.id,
            type: TASK_OPTION,
            text: shrinkTagText(task.name, 16),
            icon: task.type === TASK_TYPE_PROMPT ? 'cpu' : 'bookmark',
            task,
            action: () => {
                if (task.type === TASK_TYPE_IFRAME) {
                    store.dispatch({
                        type: 'Set iframe modal data',
                        visible: true,
                        url: task.link,
                        name: task.name,
                    })
                } else if (task.type !== TASK_TYPE_PROMPT) {
                    window.open(task.link, '_blank')
                } else if (task.variables.length === 0) {
                    store.dispatch(setPreConfigTaskExecuting(task.name))
                    // Build aiSettings from task configuration
                    const aiSettings =
                        task.aiModel || task.aiTemperature || task.aiSystemMessage
                            ? {
                                  model: task.aiModel,
                                  temperature: task.aiTemperature,
                                  systemMessage: task.aiSystemMessage,
                              }
                            : null
                    // Build taskMetadata including sendWhatsApp
                    const taskMetadata = {
                        ...(task.taskMetadata || {}),
                        sendWhatsApp: !!task.sendWhatsApp,
                    }
                    // Use the currently selected project ID instead of the assistant's original project
                    // This matches the behavior of createBotQuickTopic
                    const { loggedUser, selectedProjectIndex } = store.getState()
                    const targetProjectId =
                        selectedProjectId ||
                        (checkIfSelectedProject(selectedProjectIndex)
                            ? ProjectHelper.getProjectByIndex(selectedProjectIndex).id
                            : loggedUser.defaultProjectId)
                    generateTaskFromPreConfig(
                        targetProjectId,
                        task.name,
                        assistantId,
                        task.prompt,
                        aiSettings,
                        taskMetadata,
                        {
                            skipNavigation: true,
                        }
                    )
                }
            },
        }
    })
}

export const calculateAmountOfOptionButtons = (containerWidth, isMiddleScreen, isMobile) => {
    const filledSpaceWidth = isMiddleScreen ? 174 : 274
    const freeSpaceWidth = containerWidth - filledSpaceWidth
    const avarageWidthOfButtons = isMobile ? 130 : 150
    const calculatedAmount = Math.floor(freeSpaceWidth / avarageWidthOfButtons)

    // Ensure at least 2 buttons fit on mobile phones
    if (isMobile && calculatedAmount < 2) {
        return 2
    }

    return calculatedAmount
}

export const getOptionsPresentationData = (
    project,
    defaultAssistantId,
    tasks,
    amountOfButtonOptions,
    selectedProjectId
) => {
    const options = getOptions(project, defaultAssistantId, tasks, selectedProjectId)
    const optionsLikeButtons = options.slice(0, amountOfButtonOptions)
    const optionsInModal = options.slice(amountOfButtonOptions)
    const showSubmenu = optionsInModal.length > 0

    return { optionsLikeButtons, optionsInModal, showSubmenu }
}

export const getCommentData = (
    project,
    chatNotification,
    lastAssistantCommentData,
    defaultAssistantId,
    defaultProjectId
) => {
    const hasUnread = !!chatNotification
    const commentSource = chatNotification || lastAssistantCommentData

    if (commentSource) {
        const { creatorId, creatorType, projectId } = commentSource
        const commentProject = project || ProjectHelper.getProjectById(projectId)

        if (commentProject) {
            const projectAssistantId = commentProject.assistantId || defaultAssistantId
            const projectAssistant =
                (projectAssistantId && getAssistantInProject(commentProject.id, projectAssistantId)) ||
                (projectAssistantId ? getAssistant(projectAssistantId) : null)

            const isAssistantComment = creatorType === 'assistant'
            const commentCreator = isAssistantComment
                ? getAssistantInProject(commentProject.id, creatorId) || getAssistant(creatorId)
                : TasksHelper.getUserInProject(commentProject.id, creatorId)

            const fallbackCreator = commentCreator || projectAssistant

            if (fallbackCreator) {
                return {
                    commentCreator: fallbackCreator,
                    commentProject,
                    isAssistant: commentCreator ? isAssistantComment : true,
                    hasUnread,
                }
            }
        }
    }

    const fallbackProject = project || ProjectHelper.getProjectById(defaultProjectId)
    const fallbackAssistantId = fallbackProject?.assistantId || defaultAssistantId
    const fallbackAssistant =
        (fallbackProject?.id &&
            fallbackAssistantId &&
            getAssistantInProject(fallbackProject.id, fallbackAssistantId)) ||
        (fallbackAssistantId ? getAssistant(fallbackAssistantId) : null)

    return {
        commentCreator: fallbackAssistant,
        commentProject: fallbackProject,
        isAssistant: true,
        hasUnread: false,
    }
}

export const getAssistantLineData = (selectedProject, defaultAssistantId, defaultProjectId) => {
    const assistantId =
        selectedProject && selectedProject.assistantId ? selectedProject.assistantId : defaultAssistantId
    const assistant = getAssistant(assistantId)

    // Determine the actual project where the assistant lives
    const currentProjectId = selectedProject ? selectedProject.id : defaultProjectId
    const assistantProjectId = getAssistantProjectId(assistantId, currentProjectId)
    const assistantProject = ProjectHelper.getProjectById(assistantProjectId)

    return { assistant, assistantProject, assistantProjectId }
}
