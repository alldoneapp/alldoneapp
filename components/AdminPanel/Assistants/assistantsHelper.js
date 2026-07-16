import { setSelectedNavItem } from '../../../redux/actions'
import store from '../../../redux/store'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../utils/TabNavigationConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { DEFAULT_ALLOWED_TOOLS } from '../../AssistantDetailedView/Customizations/ToolsAccess/toolOptions'

export const TYPE_PROMPT_BASED = 'TYPE_PROMPT_BASED'
export const TYPE_3RD_PARTY = 'TYPE_3RD_PARTY'

export const MODEL_GPT3_5 = 'MODEL_GPT3_5'
export const MODEL_GPT4 = 'MODEL_GPT4'
export const MODEL_GPT4O = 'MODEL_GPT4O'
export const MODEL_GPT5_1 = 'MODEL_GPT5_1'
export const MODEL_GPT5_5 = 'MODEL_GPT5_5'
export const MODEL_GPT5_6_SOL = 'MODEL_GPT5_6_SOL'
export const MODEL_GPT5_2 = 'MODEL_GPT5_2'
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

export const DEFAULT_EMAIL_SIGNATURE = '---\nAnna Alldone\nAI Chief of Staff\nhttps://alldone.app/'

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
        model: MODEL_GPT5_6_SOL,
        temperature: TEMPERATURE_NORMAL,
        realtimeVoice: 'marin',
        emailSignature: DEFAULT_EMAIL_SIGNATURE,
        allowedTools: [...DEFAULT_ALLOWED_TOOLS],
        enabledSkillIds: [],
        delegationToolDescriptionManual: '',
        delegationToolDescriptionGenerated: '',
        delegationToolDescriptionGeneratedAt: null,
        delegationToolDescriptionInputHash: '',
        lastVisitBoard: {},
        fromTemplate: false,
        isDefault: false,
        noteIdsByProject: {},
        commentsData: null,
        heartbeatAwakeStart: 28800000,
        heartbeatAwakeEnd: 79200000,
        heartbeatIntervalMs: 1800000,
        heartbeatChancePercent: 0,
        heartbeatChanceNoReplyPercent: 0,
        heartbeatSendWhatsApp: false,
        heartbeatPrompt:
            'Check the done tasks today, comment on it and/or the chat history with one sentence and ask the user if he already did the focus task (remind him) or if there are any other ways you can help.',
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

        // Also check default project assistants (for cross-project use)
        const { loggedUser } = store.getState()
        const defaultProjectId = loggedUser?.defaultProjectId
        if (defaultProjectId && defaultProjectId !== projectId) {
            const defaultProjectAssistant = getAssistantInProject(defaultProjectId, objectAssistantId)
            if (defaultProjectAssistant) return defaultProjectAssistant
        }
    }

    return getDefaultAssistantInProjectById(projectId)
}

export const getDefaultAssistantInProjectById = projectId => {
    const project = ProjectHelper.getProjectById(projectId)
    return getDefaultAssistantInProject(project)
}

// Resolve the assistant that should automatically work on an object in the given project
// when the user triggers assistant help WITHOUT explicitly choosing one (e.g. the task list
// bot button). Unlike `getDefaultAssistantInProject` — which drives what the assistant picker
// shows by default and therefore prefers the global default — this prefers the task's own
// project so the button "just works" with that project's assistant. Preference order:
//   1. The project's own default assistant: an assistant in that project flagged `isDefault`,
//      otherwise the project's configured `project.assistantId` (project or global assistant).
//   2. The overall/global default assistant (`state.defaultAssistant`, derived from the user's
//      default project) as a fallback.
// Returns the resolved assistant object, or `null` when none can be resolved.
export const resolveDefaultAssistantForProject = projectId => {
    const { projectAssistants, defaultAssistant } = store.getState()

    // 1. The project's own default assistant.
    const assistantsInProject = (projectAssistants && projectAssistants[projectId]) || []
    const flaggedDefault = assistantsInProject.find(assistant => assistant.isDefault)
    if (flaggedDefault) return flaggedDefault

    const project = ProjectHelper.getProjectById(projectId)
    if (project && project.assistantId) {
        const projectAssistant = getAssistantInProject(projectId, project.assistantId)
        if (projectAssistant) return projectAssistant
    }

    // 2. Fallback to the overall/global default assistant.
    if (defaultAssistant && defaultAssistant.uid) return defaultAssistant

    return null
}

const getDefaultAssistantInProject = project => {
    // Always default to the default assistant from the user's default project, not the
    // per-project assistant. The project assistant (project.assistantId) is still selectable
    // in the assistant picker, but it should no longer be the one shown by default.
    const { defaultAssistant } = store.getState()
    if (defaultAssistant && defaultAssistant.uid) return defaultAssistant

    // Fallback only when the default project has no assistant at all: use the project's own.
    if (project && project.assistantId) {
        const assistant = getAssistantInProject(project.id, project.assistantId)
        if (assistant) return assistant
    }

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
