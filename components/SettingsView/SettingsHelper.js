import { LogOut, navigateToUpdates, navigateToSettings } from '../../redux/actions'
import store from '../../redux/store'
import ProjectHelper, { ALL_PROJECTS_INDEX, checkIfSelectedAllProjects } from './ProjectsSettings/ProjectHelper'
import URLsSettings, {
    URL_CUSTOMIZATIONS,
    URL_SETTINGS_INVITATIONS,
    URL_SETTINGS_PREMIUM,
    URL_SETTINGS_PROJECTS,
    URL_SETTINGS_SHORTCUTS,
    URL_SETTINGS_STATISTICS,
    URL_SETTINGS_PROFILE,
    URL_SETTINGS_EXPORT,
} from '../../URLSystem/Settings/URLsSettings'
import URLSystem, {
    URL_FEEDS_FOLLOWED,
    URL_FEEDS_NOT_FOLLOWED,
    URL_PROJECT_FEEDS_FOLLOWED,
    URL_PROJECT_FEEDS_NOT_FOLLOWED,
} from '../../URLSystem/URLSystem'
import { ROOT_ROUTES } from '../../utils/TabNavigationConstants'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_GUIDE } from './ProjectsSettings/ProjectsSettings'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { deleteCache } from '../../utils/Observers'

class SettingsHelper {
    /**
     * @param navigation
     * @param tab       [User, Projects,, Template projects Archived projects]
     * @param type      [PROJECT_TYPE_ACTIVE,PROJECT_TYPE_GUIDE, PROJECT_TYPE_ARCHIVED]
     */
    static processURLSettingsTab = (navigation, tab, type) => {
        if (tab === URL_SETTINGS_PROJECTS) {
            const sectionIndex = type === PROJECT_TYPE_ACTIVE ? 0 : PROJECT_TYPE_GUIDE ? 1 : 2
            store.dispatch(navigateToSettings({ selectedNavItem: tab, projectTypeSectionIndex: sectionIndex }))
        } else {
            store.dispatch(navigateToSettings({ selectedNavItem: tab }))
        }

        switch (tab) {
            case URL_CUSTOMIZATIONS:
                URLsSettings.replace(URL_CUSTOMIZATIONS)
                break
            case URL_SETTINGS_PROFILE:
                URLsSettings.replace(URL_SETTINGS_PROFILE)
                break
            case URL_SETTINGS_PROJECTS:
                URLsSettings.replace(URL_SETTINGS_PROJECTS)
                break
            case URL_SETTINGS_INVITATIONS:
                URLsSettings.replace(URL_SETTINGS_INVITATIONS)
                break
            case URL_SETTINGS_STATISTICS:
                URLsSettings.replace(URL_SETTINGS_STATISTICS)
                break
            case URL_SETTINGS_SHORTCUTS:
                URLsSettings.replace(URL_SETTINGS_SHORTCUTS)
                break
            case URL_SETTINGS_PREMIUM:
                URLsSettings.replace(URL_SETTINGS_PREMIUM)
                break
            case URL_SETTINGS_EXPORT:
                URLsSettings.replace(URL_SETTINGS_EXPORT)
                break
        }
        navigation.navigate('SettingsView')
    }

    static processURLFeeds = (navigation, constant, projectId, userId) => {
        const { route } = store.getState()
        const projectIndex = projectId ? ProjectHelper.getProjectIndexById(projectId) : ALL_PROJECTS_INDEX
        const feedActiveTab = getFollowedStateByURLConstant(constant, checkIfSelectedAllProjects(projectIndex))

        if (!ROOT_ROUTES.includes(route)) navigation.navigate('Root')
        store.dispatch(navigateToUpdates({ selectedProjectIndex: projectIndex, feedActiveTab }))

        const data = projectId ? { projectId } : {}

        URLSystem.replace(constant, data, projectId, userId)
    }

    static processURLPrivateResource = navigation => {
        navigation.navigate('PrivateResource')
    }

    static processURLPaymentSuccess = navigation => {
        navigation.navigate('PaymentSuccess')
    }

    static onLogOut(redirectToRoot = true) {
        //const cookie = JSON.parse(localStorage.getItem('alldone_cookie')) || {}
        //cookie.loggedIn = false
        //localStorage.setItem('alldone_cookie', JSON.stringify(cookie))
        store.dispatch(LogOut())
        deleteCache()
        if (redirectToRoot) {
            document.location = window.location.origin
        }
    }
}

const getFollowedStateByURLConstant = (constant, isAllProjects = false) => {
    switch (constant) {
        case isAllProjects ? URL_FEEDS_FOLLOWED : URL_PROJECT_FEEDS_FOLLOWED:
            return FOLLOWED_TAB
        case isAllProjects ? URL_FEEDS_NOT_FOLLOWED : URL_PROJECT_FEEDS_NOT_FOLLOWED:
            return ALL_TAB
        default:
            return FOLLOWED_TAB
    }
}

export default SettingsHelper
