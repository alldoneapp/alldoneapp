import {
    navigateToAllProjectsTasks,
    setBacklinkSection,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    storeCurrentUser,
    switchProject,
} from '../../redux/actions'
import store from '../../redux/store'
import URLsAssistants, {
    URL_ASSISTANT_DETAILS_CUSTOMIZATIONS,
    URL_ASSISTANT_DETAILS_BACKLINKS_NOTES,
    URL_ASSISTANT_DETAILS_BACKLINKS_TASKS,
    URL_ASSISTANT_DETAILS_NOTE,
    URL_ASSISTANT_DETAILS_CHAT,
    URL_ASSISTANT_DETAILS_UPDATES,
} from '../../URLSystem/Assistants/URLsAssistants'
import {
    DV_TAB_ASSISTANT_BACKLINKS,
    DV_TAB_ASSISTANT_CHAT,
    DV_TAB_ASSISTANT_CUSTOMIZATIONS,
    DV_TAB_ASSISTANT_NOTE,
    DV_TAB_ASSISTANT_UPDATES,
    DV_TAB_ROOT_TASKS,
} from '../../utils/TabNavigationConstants'
import { GLOBAL_PROJECT_ID } from '../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper, { ALL_PROJECTS_INDEX } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_ACTIVE } from '../SettingsView/ProjectsSettings/ProjectsSettings'

export const AssistantDetailedViewHelper = (navigation, tab, assistantId, projectId, filterConstant) => {
    const { loggedUser, administratorUser } = store.getState()
    const accessGranted =
        projectId !== GLOBAL_PROJECT_ID || (!loggedUser.isAnonymous && loggedUser.uid === administratorUser.uid)

    if (accessGranted) {
        const backlinkSection = {
            index: filterConstant === URL_ASSISTANT_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section: filterConstant === URL_ASSISTANT_DETAILS_BACKLINKS_TASKS ? 'Tasks' : 'Notes',
        }
        tab =
            filterConstant === URL_ASSISTANT_DETAILS_BACKLINKS_TASKS ||
            filterConstant === URL_ASSISTANT_DETAILS_BACKLINKS_NOTES
                ? DV_TAB_ASSISTANT_BACKLINKS
                : tab
        tab = !accessGranted && tab === DV_TAB_ASSISTANT_BACKLINKS ? DV_TAB_ASSISTANT_CUSTOMIZATIONS : tab

        store.dispatch([setSelectedNavItem(tab), storeCurrentUser(loggedUser)])
        switch (tab) {
            case DV_TAB_ASSISTANT_CUSTOMIZATIONS:
                URLsAssistants.replace(
                    URL_ASSISTANT_DETAILS_CUSTOMIZATIONS,
                    { assistantId, projectId },
                    projectId,
                    assistantId
                )
                break
        }
        switch (tab) {
            case DV_TAB_ASSISTANT_BACKLINKS:
                URLsAssistants.replace(filterConstant, { assistantId, projectId }, projectId, assistantId)
                break
        }
        switch (tab) {
            case DV_TAB_ASSISTANT_NOTE:
                URLsAssistants.replace(URL_ASSISTANT_DETAILS_NOTE, { assistantId, projectId }, projectId, assistantId)
                break
        }
        switch (tab) {
            case DV_TAB_ASSISTANT_CHAT:
                URLsAssistants.replace(URL_ASSISTANT_DETAILS_CHAT, { assistantId, projectId }, projectId, assistantId)
                break
        }
        switch (tab) {
            case DV_TAB_ASSISTANT_UPDATES:
                URLsAssistants.replace(
                    URL_ASSISTANT_DETAILS_UPDATES,
                    { assistantId, projectId },
                    projectId,
                    assistantId
                )
                break
        }
        const index =
            projectId === GLOBAL_PROJECT_ID ? ALL_PROJECTS_INDEX : ProjectHelper.getProjectIndexById(projectId)
        const type =
            projectId === GLOBAL_PROJECT_ID
                ? PROJECT_TYPE_ACTIVE
                : ProjectHelper.getTypeOfProject(loggedUser, projectId)

        store.dispatch([
            switchProject(index),
            storeCurrentUser(loggedUser),
            setSelectedTypeOfProject(type),
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            setBacklinkSection(backlinkSection),
        ])
        navigation.navigate('AssistantDetailedView', { assistantId, projectId })
    } else {
        navigation.navigate('Root')
        store.dispatch(navigateToAllProjectsTasks())
    }
}
