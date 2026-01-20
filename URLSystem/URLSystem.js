// URL definitions
// ========================

// Feeds
import store from '../redux/store'
import { setLastVisitedScreen } from '../redux/actions'
import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import HelperFunctions from '../utils/HelperFunctions'
import { shrinkTagText } from '../functions/Utils/parseTextUtils'

/**
 * /updates/followed
 */
export const URL_FEEDS_FOLLOWED = 'FEEDS_FOLLOWED'

/**
 * /updates/all
 */
export const URL_FEEDS_NOT_FOLLOWED = 'FEEDS_NOT_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/updates/followed
 */
export const URL_PROJECT_FEEDS_FOLLOWED = 'PROJECT_FEEDS_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/updates/all
 */
export const URL_PROJECT_FEEDS_NOT_FOLLOWED = 'PROJECT_FEEDS_NOT_FOLLOWED'

/**
 * /private-resource
 */
export const URL_PRIVATE_RESOURCE = 'PRIVATE_RESOURCE'

// Logout User
/**
 * /logout
 */
export const URL_LOGOUT = 'LOGOUT'

/**
 * /login
 */
export const URL_LOGIN = 'LOGIN'

/**
 * /starttrial
 */
export const URL_START_TRIAL = 'START_TRIAL'

/**
 * /paymentsuccess
 */
export const URL_PAYMENT_SUCCESS = 'PAYMENT_SUCCESS'

/**
 * /onboarding
 */
export const URL_ONBOARDING = 'ONBOARDING'

class URLSystem {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLSystem.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLSystem.setTitle(urlConstant, ...params)
        history.replaceState(data, '', `${originPath}/${urlPath}`)
    }

    /**
     * Push a new state into the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static push = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLSystem.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLSystem.setTitle(urlConstant, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_FEEDS_FOLLOWED:
                return `updates/followed`
            case URL_FEEDS_NOT_FOLLOWED:
                return `updates/all`
            case URL_PROJECT_FEEDS_FOLLOWED:
                return `projects/${params[0]}/user/${params[1]}/updates/followed`
            case URL_PROJECT_FEEDS_NOT_FOLLOWED:
                return `projects/${params[0]}/user/${params[1]}/updates/all`
            case URL_PRIVATE_RESOURCE:
                return `private-resource`
            case URL_LOGOUT:
                return `logout`
            case URL_LOGIN:
                return `login`
            case URL_START_TRIAL:
                return `starttrial`
            case URL_PAYMENT_SUCCESS:
                return `paymentsuccess`
        }
    }

    static setTitle = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_FEEDS_FOLLOWED:
                document.title = 'Alldone.app - All projects - Followed updates'
                break
            case URL_FEEDS_NOT_FOLLOWED:
                document.title = 'Alldone.app - All projects - Not followed updates'
                break
            case URL_PROJECT_FEEDS_FOLLOWED: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                document.title = `Alldone.app - ${projectName} - ${shrinkTagText(userName)} - Followed updates`
                break
            }
            case URL_PROJECT_FEEDS_NOT_FOLLOWED: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                document.title = `Alldone.app - ${projectName} - ${shrinkTagText(userName)} - Not followed updates`
                break
            }
            case URL_PRIVATE_RESOURCE: {
                document.title = `Alldone.app - Private resource`
                break
            }
            case URL_LOGIN: {
                document.title = `Alldone.app - Login`
                break
            }
            case URL_START_TRIAL: {
                document.title = `Alldone.app - Start Trial`
                break
            }
            case URL_PAYMENT_SUCCESS: {
                document.title = `Alldone.app - Payment Success`
                break
            }
        }
    }

    static setLastNavigationScreen = (urlPath, isReplace = false) => {
        let { lastVisitedScreen } = store.getState()
        const currPath = `/${urlPath}`
        const lastPath = lastVisitedScreen.slice(-1)[0]
        if (currPath !== lastPath) {
            if (lastVisitedScreen.length > 0) {
                if (isReplace) {
                    lastVisitedScreen.pop()
                }
                lastVisitedScreen.push(currPath)
            } else {
                lastVisitedScreen = [currPath]
            }
        }

        store.dispatch(setLastVisitedScreen(lastVisitedScreen))
    }
}

export default URLSystem
