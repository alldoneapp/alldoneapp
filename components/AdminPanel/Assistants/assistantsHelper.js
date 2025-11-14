import { setSelectedNavItem } from '../../../redux/actions'
import store from '../../../redux/store'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../utils/TabNavigationConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

export const TYPE_PROMPT_BASED = 'TYPE_PROMPT_BASED'
export const TYPE_3RD_PARTY = 'TYPE_3RD_PARTY'

export const MODEL_GPT3_5 = 'MODEL_GPT3_5'
export const MODEL_GPT4 = 'MODEL_GPT4'
export const MODEL_GPT4O = 'MODEL_GPT4O'
export const MODEL_GPT5_1 = 'MODEL_GPT5_1'
export const MODEL_SONAR = 'MODEL_SONAR'
export const MODEL_SONAR_PRO = 'MODEL_SONAR_PRO'
export const MODEL_SONAR_REASONING = 'MODEL_SONAR_REASONING'
export const MODEL_SONAR_REASONING_PRO = 'MODEL_SONAR_REASONING_PRO'
export const MODEL_SONAR_DEEP_RESEARCH = 'MODEL_SONAR_DEEP_RESEARCH'

export const TEMPERATURE_VERY_LOW = 'TEMPERATURE_VERY_LOW'
export const TEMPERATURE_LOW = 'TEMPERATURE_LOW'
export const TEMPERATURE_NORMAL = 'TEMPERATURE_NORMAL'
export const TEMPERATURE_HIGH = 'TEMPERATURE_HIGH'
export const TEMPERATURE_VERY_HIGH = 'TEMPERATURE_VERY_HIGH'

export const GLOBAL_PROJECT_ID = 'globalProject'

export function getNewDefaultAssistant() {
    const { loggedUser } = store.getState()
    return {
        displayName: '',
        lastEditorId: loggedUser.uid,
        lastEditionDate: Date.now(),
        creatorId: loggedUser.uid,
        createdDate: Date.now(),
        photoURL: '',
        photoURL50: '',
        photoURL300: '',
        description: '',
        prompt: '',
        thirdPartLink: '',
        type: TYPE_PROMPT_BASED,
        instructions: '',
        model: MODEL_GPT5_1,
        temperature: TEMPERATURE_NORMAL,
        lastVisitBoard: {},
        fromTemplate: false,
        isDefault: false,
        noteIdsByProject: {},
        commentsData: null,
    }
}

export const isGlobalAssistant = assistantId => {
    const { globalAssistants } = store.getState()
    return globalAssistants.some(assistant => assistant.uid === assistantId)
}

export const getGlobalAssistant = assistantId => {
    const { globalAssistants } = store.getState()

    for (let i = 0; i < globalAssistants.length; i++) {
        if (globalAssistants[i].uid === assistantId) return globalAssistants[i]
    }

    return null
}

const getGlobalAssistantInProject = (projectId, assistantId) => {
    const project = ProjectHelper.getProjectById(projectId)
    return project && project.globalAssistantIds.includes(assistantId) ? getGlobalAssistant(assistantId) : null
}

const getNormalAssistant = assistantId => {
    const { projectAssistants } = store.getState()

    const assistantsByProject = Object.keys(projectAssistants)

    for (let i = 0; i < assistantsByProject.length; i++) {
        const assistant = getNormalAssistantInProject(assistantsByProject[i], assistantId)
        if (assistant) return assistant
    }

    return null
}

export const openAssistantDv = (projectId, assistant) => {
    NavigationService.navigate('AssistantDetailedView', {
        assistantId: assistant.uid,
        assistant,
        projectId,
    })
    store.dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
}

const getNormalAssistantInProject = (projectId, assistantId) => {
    const { projectAssistants } = store.getState()

    const assistants = projectAssistants[projectId] || []

    for (let n = 0; n < assistants.length; n++) {
        if (assistants[n].uid === assistantId) return assistants[n]
    }

    return null
}

export const getAssistant = assistantId => {
    const globalAssistant = getGlobalAssistant(assistantId)
    if (globalAssistant) return globalAssistant

    return getNormalAssistant(assistantId)
}

export const getAssistantInProject = (projectId, assistantId) => {
    const globalAssistant = getGlobalAssistantInProject(projectId, assistantId)
    if (globalAssistant) return globalAssistant

    return getNormalAssistantInProject(projectId, assistantId)
}

export const getAssistantInProjectObject = (projectId, objectAssistantId) => {
    if (objectAssistantId) {
        // First check if it's a global assistant
        const globalAssistant = getGlobalAssistant(objectAssistantId)
        if (globalAssistant) {
            // For global assistants, verify it's in the project
            const project = ProjectHelper.getProjectById(projectId)
            if (project && project.globalAssistantIds.includes(objectAssistantId)) {
                return globalAssistant
            }
        }

        // If not a global assistant or not in project, check project assistants
        const assistant = getAssistantInProject(projectId, objectAssistantId)
        if (assistant) return assistant
    }

    return getDefaultAssistantInProjectById(projectId)
}

export const getDefaultAssistantInProjectById = projectId => {
    const project = ProjectHelper.getProjectById(projectId)
    return getDefaultAssistantInProject(project)
}

const getDefaultAssistantInProject = project => {
    if (project && project.assistantId) {
        const assistant = getAssistantInProject(project.id, project.assistantId)
        if (assistant) return assistant
    }

    const { defaultAssistant } = store.getState()
    return defaultAssistant
}

export const getAssistantProjectId = (assistantId, currentProjectId) => {
    // First check if it's a global assistant
    if (isGlobalAssistant(assistantId)) {
        return GLOBAL_PROJECT_ID
    }

    // Check if assistant exists in the current project
    const assistantInCurrentProject = getNormalAssistantInProject(currentProjectId, assistantId)
    if (assistantInCurrentProject) {
        return currentProjectId
    }

    // If not found in current project, check if we're using default project's assistant
    const currentProject = ProjectHelper.getProjectById(currentProjectId)
    const { defaultProjectId } = store.getState()

    if (currentProject && !currentProject.assistantId && defaultProjectId && currentProjectId !== defaultProjectId) {
        // Check if assistant exists in default project
        const assistantInDefaultProject = getNormalAssistantInProject(defaultProjectId, assistantId)
        if (assistantInDefaultProject) {
            return defaultProjectId
        }
    }

    // Fallback: search all projects
    const { projectAssistants } = store.getState()
    const assistantsByProject = Object.keys(projectAssistants)

    for (let i = 0; i < assistantsByProject.length; i++) {
        const assistant = getNormalAssistantInProject(assistantsByProject[i], assistantId)
        if (assistant) return assistantsByProject[i]
    }

    // If still not found, return current project as fallback
    return currentProjectId
}
