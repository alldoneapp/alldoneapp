import { translate } from '../../../../i18n/TranslationService'
import { TASK_TYPE_PROMPT } from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import { createBotQuickTopic, generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import { getAssistant, getAssistantInProject } from '../../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'

const NEW_CHAT_OPTION = 'NEW_CHAT_OPTION'
export const TASK_OPTION = 'TASK_OPTION'

const getOptions = (project, assistantId, tasks) => {
    const options = [
        {
            id: NEW_CHAT_OPTION,
            type: NEW_CHAT_OPTION,
            text: translate('New chat'),
            icon: 'cpu',
            action: () => {
                const assistant = getAssistantInProject(project.id, assistantId)
                createBotQuickTopic(assistant)
            },
        },
        ...tasks.map(task => {
            return {
                id: task.id,
                type: TASK_OPTION,
                text: shrinkTagText(task.name, 8),
                icon: task.type === TASK_TYPE_PROMPT ? 'cpu' : 'bookmark',
                task,
                action: () => {
                    if (task.type !== TASK_TYPE_PROMPT) {
                        window.open(task.link, '_blank')
                    } else if (task.variables.length === 0) {
                        generateTaskFromPreConfig(project.id, task.name, assistantId, task.prompt)
                    }
                },
            }
        }),
    ]

    return options
}

export const calculateAmountOfOptionButtons = (containerWidth, isMiddleScreen) => {
    const filledSpaceWidth = isMiddleScreen ? 174 : 274
    const freeSpaceWidth = containerWidth - filledSpaceWidth
    const avarageWidthOfButtons = 130
    return Math.floor(freeSpaceWidth / avarageWidthOfButtons)
}

export const getOptionsPresentationData = (project, defaultAssistantId, tasks, amountOfButtonOptions) => {
    const options = getOptions(project, defaultAssistantId, tasks)
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
    if (chatNotification || lastAssistantCommentData) {
        const { creatorId, creatorType, projectId } = chatNotification || lastAssistantCommentData
        const commentProject = project || ProjectHelper.getProjectById(projectId)
        if (commentProject) {
            const isAssistant = creatorType === 'assistant'
            const commentCreator = isAssistant
                ? getAssistantInProject(commentProject.id, creatorId)
                : TasksHelper.getUserInProject(commentProject.id, creatorId)
            return { commentCreator, commentProject, isAssistant }
        }
    }
    return {
        commentCreator: getAssistant(project?.assistantId || defaultAssistantId),
        commentProject: project || ProjectHelper.getProjectById(defaultProjectId),
        isAssistant: true,
        showNoComment: true,
    }
}

export const getAssistantLineData = (selectedProject, defaultAssistantId, defaultProjectId) => {
    const assistantId =
        selectedProject && selectedProject.assistantId ? selectedProject.assistantId : defaultAssistantId
    const assistant = getAssistant(assistantId)
    const assistantProject = selectedProject || ProjectHelper.getProjectById(defaultProjectId)
    const assistantProjectId = assistantProject ? assistantProject.id : ''
    return { assistant, assistantProject, assistantProjectId }
}
