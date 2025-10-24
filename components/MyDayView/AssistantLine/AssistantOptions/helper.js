import { translate } from '../../../../i18n/TranslationService'
import { TASK_TYPE_PROMPT } from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import { getAssistant, getAssistantInProject } from '../../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import store from '../../../../redux/store'
import { setPreConfigTaskExecuting } from '../../../../redux/actions'

export const TASK_OPTION = 'TASK_OPTION'

const getOptions = (project, assistantId, tasks) => {
    return tasks.map(task => {
        return {
            id: task.id,
            type: TASK_OPTION,
            text: shrinkTagText(task.name, 16),
            icon: task.type === TASK_TYPE_PROMPT ? 'cpu' : 'bookmark',
            task,
            action: () => {
                if (task.type !== TASK_TYPE_PROMPT) {
                    window.open(task.link, '_blank')
                } else if (task.variables.length === 0) {
                    store.dispatch(setPreConfigTaskExecuting(true))
                    generateTaskFromPreConfig(project.id, task.name, assistantId, task.prompt, null, null, {
                        skipNavigation: true,
                    })
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
    const assistantProject = selectedProject || ProjectHelper.getProjectById(defaultProjectId)
    const assistantProjectId = assistantProject ? assistantProject.id : ''
    return { assistant, assistantProject, assistantProjectId }
}
