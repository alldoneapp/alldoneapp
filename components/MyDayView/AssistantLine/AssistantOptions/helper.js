import {
    getAssistant,
    getAssistantInProject,
    getAssistantProjectId,
} from '../../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'

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
        // A source that names its project must be rendered in THAT project. The preview subscribes
        // to chatComments/<commentProject>/<objectType>/<objectId>, and under any other project the
        // thread does not exist, so the rules deny it. That denial is not harmless: when the preview
        // then remounts under the right project, removing the rejected listener raced the server's
        // rejection and Firestore answered `Target id not found`, which tears down the WHOLE Listen
        // stream. It happened on every boot of the All projects board, because project users and
        // assistants load after this pointer and the old code fell back to the displayed project
        // until they did. Show the skeleton instead of a wrong-project preview.
        const sourceProject = projectId ? ProjectHelper.getProjectById(projectId) : null
        if (projectId && !sourceProject)
            return { commentCreator: null, commentProject: null, isAssistant: false, hasUnread }
        const commentProject = sourceProject || project

        if (commentProject) {
            const projectAssistantId = commentProject.assistantId || defaultAssistantId
            const projectAssistant =
                (projectAssistantId && getAssistantInProject(commentProject.id, projectAssistantId)) ||
                (projectAssistantId ? getAssistant(projectAssistantId) : null) ||
                (projectId && defaultAssistantId ? getAssistant(defaultAssistantId) : null)

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
            if (projectId) return { commentCreator: null, commentProject: null, isAssistant: false, hasUnread }
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
