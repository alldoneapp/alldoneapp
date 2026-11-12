import { DV_TAB_ROOT_CHATS, ROOT_ROUTES } from '../../../utils/TabNavigationConstants'
import { ALL_TAB } from '../../Feeds/Utils/FeedsConstants'

/**
 * "All chats" on the assistant line's Last comment row: opens the Chats list, on its All tab, for
 * the project the line belongs to. A line inside a project's section of an All projects board
 * switches to that project first; a line without a project of its own (the All projects line)
 * opens the chats of all projects, staying where it is.
 *
 * The store, actions and navigation are required when pressed, like `RageModeButton` reads the
 * store: the Last comment area is rendered by many suites that do not build the whole app.
 */
export const openChatsList = project => {
    const store = require('../../../redux/store').default
    const {
        hideFloatPopup,
        hideWebSideBar,
        setChatsActiveTab,
        setSelectedSidebarTab,
        setSelectedTypeOfProject,
        storeCurrentShortcutUser,
        switchProject,
    } = require('../../../redux/actions')
    const NavigationService = require('../../../utils/NavigationService').default
    const ProjectHelper = require('../../SettingsView/ProjectsSettings/ProjectHelper').default

    const { route, selectedProjectIndex, loggedUser, smallScreenNavigation } = store.getState()

    if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')

    const actions = [setChatsActiveTab(ALL_TAB), setSelectedSidebarTab(DV_TAB_ROOT_CHATS), hideFloatPopup()]

    if (project && Number.isInteger(project.index) && project.index !== selectedProjectIndex) {
        actions.push(
            setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
            storeCurrentShortcutUser(null),
            switchProject(project.index)
        )
    }

    if (smallScreenNavigation) actions.push(hideWebSideBar())

    store.dispatch(actions)
}
