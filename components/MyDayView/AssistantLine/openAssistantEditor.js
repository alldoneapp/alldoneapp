import store from '../../../redux/store'
import NavigationService from '../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../redux/actions'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../utils/TabNavigationConstants'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

const projectHasGlobalAssistant = (projectId, assistantId) => {
    const project = projectId ? ProjectHelper.getProjectById(projectId) : null
    return !!project && Array.isArray(project.globalAssistantIds) && project.globalAssistantIds.includes(assistantId)
}

/**
 * AT-3069 — which project the assistant line's edit pencil opens the assistant in.
 *
 * A project assistant opens in the project it lives in (`lineProjectId`, the line's
 * `assistantProject`). A global assistant (Anna, templates) opens in the global project only for
 * the Alldone administrator, the one person allowed to edit it there; everybody else would be
 * thrown out with "access denied". For them it opens inside a project that carries it
 * (`globalAssistantIds`), where `AssistantDetailedView` shows it read-only with "copy to edit",
 * exactly like a click on it in the sidebar. The line's own project is preferred, then the
 * default project, then any of the person's projects.
 */
export const getAssistantEditorProjectId = (assistantId, lineProjectId) => {
    if (!isGlobalAssistant(assistantId)) return lineProjectId

    const { loggedUser = {}, administratorUser, loggedUserProjects = [] } = store.getState()
    if (!loggedUser.isAnonymous && !!loggedUser.uid && loggedUser.uid === administratorUser?.uid) {
        return GLOBAL_PROJECT_ID
    }

    const candidates = [lineProjectId, loggedUser.defaultProjectId, ...loggedUserProjects.map(project => project?.id)]
    return candidates.find(projectId => projectHasGlobalAssistant(projectId, assistantId)) || lineProjectId
}

/**
 * Opens the assistant's detailed view on its Customizations tab (its settings). Ignored while a
 * float popup is open, so a press that only closes a popup does not also navigate away.
 */
export default function openAssistantEditor(assistantId, lineProjectId) {
    const { showFloatPopup } = store.getState()
    if (!assistantId || showFloatPopup) return

    const projectId = getAssistantEditorProjectId(assistantId, lineProjectId)
    if (!projectId) return

    NavigationService.navigate('AssistantDetailedView', { assistantId, projectId })
    store.dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
}
