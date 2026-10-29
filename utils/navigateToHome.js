import { navigateToAllProjectsTasks, setSelectedSidebarTab, switchProject } from '../redux/actions'
import { DV_TAB_ROOT_TASKS } from './TabNavigationConstants'
import { ALL_PROJECTS_INDEX } from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from './NavigationService'

// "Home" is the open task list of all projects, wherever the button sits: the top bar and the
// assistant-mode header (AT-2920) carry the same badge and must land on the same view.
export default function navigateToHome(dispatch) {
    // Required lazily: HelperFunctions pulls in the whole backend bridge, which the assistant
    // shell does not otherwise need at import time.
    require('./HelperFunctions').dismissAllPopups()
    dispatch([
        switchProject(ALL_PROJECTS_INDEX),
        setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
        navigateToAllProjectsTasks({ taskViewToggleSection: 'Open', taskViewToggleIndex: 0 }),
    ])
    NavigationService.navigate('Root')
}
