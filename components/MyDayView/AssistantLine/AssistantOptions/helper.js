import { translate } from '../../../../i18n/TranslationService'
import { TASK_TYPE_PROMPT, TASK_TYPE_IFRAME } from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { shrinkTagText } from '../../../../functions/Utils/parseTextUtils'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import {
    getAssistant,
    getAssistantInProject,
    getAssistantProjectId,
} from '../../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import store from '../../../../redux/store'
import { setPreConfigTaskExecuting } from '../../../../redux/actions'
import { getAssistantTaskIcon, isScheduledAssistantTask } from './assistantTaskIcon'

export const TASK_OPTION = 'TASK_OPTION'

const getOptions = (project, assistantId, tasks, showFullLabels = false) => {
    const quickLinkTasks = tasks.filter(task => !isScheduledAssistantTask(task))

    return quickLinkTasks.map(task => {
        return {
            id: task.id,
            type: TASK_OPTION,
            text: showFullLabels ? task.name : shrinkTagText(task.name, 16),
            icon: getAssistantTaskIcon(task),
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
                        task.aiModel || task.aiReasoningEffort !== undefined || task.aiSystemMessage
                            ? {
                                  model: task.aiModel,
                                  reasoningEffort: task.aiReasoningEffort,
                                  systemMessage: task.aiSystemMessage,
                              }
                            : null
                    // Build taskMetadata including sendWhatsApp
                    const taskMetadata = {
                        ...(task.taskMetadata || {}),
                        sendWhatsApp: !!task.sendWhatsApp,
                        executionMode: task.executionMode,
                    }
                    const targetProjectId = project?.id
                    if (!targetProjectId) return
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

export const getCollapsedQuickActionCount = ({ containerWidth, searchWidth, moreWidth, optionWidths }) => {
    if (optionWidths.length === 0) return 0

    const hasCompleteMeasurements = containerWidth > 0 && searchWidth > 0 && optionWidths.every(width => width > 0)
    if (!hasCompleteMeasurements) return 0

    const allOptionsWidth = optionWidths.reduce((total, width) => total + width, 0)
    if (searchWidth + allOptionsWidth <= containerWidth) return optionWidths.length

    // If any option is hidden, More has to fit on the same line too. Until More has been
    // measured, keep every task hidden rather than briefly rendering a wrapping row.
    if (moreWidth <= 0) return 0

    const availableOptionsWidth = Math.max(0, containerWidth - searchWidth - moreWidth)
    let usedWidth = 0
    let visibleCount = 0

    for (const width of optionWidths) {
        if (usedWidth + width > availableOptionsWidth) break
        usedWidth += width
        visibleCount += 1
    }

    return visibleCount
}

export const getOptionsPresentationData = (
    project,
    defaultAssistantId,
    tasks,
    amountOfButtonOptions,
    showAllOptions = false
) => {
    const options = getOptions(project, defaultAssistantId, tasks, showAllOptions)
    const hasAdditionalOptions = options.length > amountOfButtonOptions

    if (showAllOptions) {
        return { optionsLikeButtons: options, optionsInModal: [], showSubmenu: false, hasAdditionalOptions }
    }
    const optionsLikeButtons = options.slice(0, amountOfButtonOptions)
    const optionsInModal = options.slice(amountOfButtonOptions)
    const showSubmenu = optionsInModal.length > 0

    return { optionsLikeButtons, optionsInModal, showSubmenu, hasAdditionalOptions }
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
        const commentProject = (projectId && ProjectHelper.getProjectById(projectId)) || project

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

export const getAssistantLineData = (
    selectedProject,
    defaultAssistantId,
    defaultProjectId,
    preferAssistantId = false
) => {
    const assistantId =
        preferAssistantId && defaultAssistantId
            ? defaultAssistantId
            : selectedProject && selectedProject.assistantId
              ? selectedProject.assistantId
              : defaultAssistantId
    const assistant = getAssistant(assistantId)

    // Determine the actual project where the assistant lives
    const currentProjectId = selectedProject ? selectedProject.id : defaultProjectId
    const assistantProjectId = getAssistantProjectId(assistantId, currentProjectId)

    // Try to get the project where the assistant is defined
    let assistantProject = ProjectHelper.getProjectById(assistantProjectId)

    // Fallback: If the project is not found (e.g. it's 'globalProject'), use the current project context
    if (!assistantProject) {
        if (selectedProject) {
            assistantProject = selectedProject
        } else if (defaultProjectId) {
            assistantProject = ProjectHelper.getProjectById(defaultProjectId)
        }
    }

    return { assistant, assistantProject, assistantProjectId }
}
