import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /projects/chats/followed
 */
export const URL_ALL_PROJECTS_CHATS_FOLLOWED = 'ALL_PROJECTS_CHATS_FOLLOWED'

/**
 * /projects/chats/all
 */
export const URL_ALL_PROJECTS_CHATS_ALL = 'ALL_PROJECTS_CHATS_ALL'

/**
 * /projects/{projectId}/user/{userId}/chats/followed
 */
export const URL_PROJECT_USER_CHATS_FOLLOWED = 'PROJECT_CHATS_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/chats/all
 */
export const URL_PROJECT_USER_CHATS_ALL = 'PROJECT_CHATS_ALL'

/**
 * /projects/{projectId}/chats/{chatId}/chat
 */
export const URL_CHAT_DETAILS = 'CHAT_DETAILS'

/**
 * /projects/{projectId}/chats/{chatId}/properties
 */
export const URL_CHAT_DETAILS_PROPERTIES = 'CHAT_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/chats/{chatId}/properties
 */
export const URL_CHAT_DETAILS_NOTE = 'CHAT_DETAILS_NOTE'

/**
 * URL System for Notes
 */
class URLsChats {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsChats.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsChats.setTitle(urlConstant, ...params)
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
        let urlPath = URLsChats.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsChats.setTitle(urlConstant, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ALL_PROJECTS_CHATS_FOLLOWED:
                return `projects/chats/followed`
            case URL_ALL_PROJECTS_CHATS_ALL:
                return `projects/chats/all`
            case URL_PROJECT_USER_CHATS_FOLLOWED:
                return `projects/${params[0]}/user/${params[1]}/chats/followed`
            case URL_PROJECT_USER_CHATS_ALL:
                return `projects/${params[0]}/user/${params[1]}/chats/all`
            case URL_CHAT_DETAILS:
                return `projects/${params[0]}/chats/${params[1]}/chat`
            case URL_CHAT_DETAILS_PROPERTIES:
                return `projects/${params[0]}/chats/${params[1]}/properties`
            case URL_CHAT_DETAILS_NOTE:
                return `projects/${params[0]}/chats/${params[1]}/note`
        }
    }

    static setTitle = (urlConstant, ...params) => {
        const projectUserNotes = (pre = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            document.title = `Alldone.app - ${shrinkTagText(projectName)} - ${pre} Chats`
        }

        const chatDetails = (titleSuffix = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            document.title = `Alldone.app - ${shrinkTagText(projectName)} - Chat details${titleSuffix}`
        }

        switch (urlConstant) {
            case URL_ALL_PROJECTS_CHATS_FOLLOWED: {
                document.title = `Alldone.app - All projects - Followed Chats`
                break
            }
            case URL_ALL_PROJECTS_CHATS_ALL: {
                document.title = `Alldone.app - All projects - All Chats`
                break
            }
            case URL_PROJECT_USER_CHATS_FOLLOWED: {
                projectUserNotes('Followed')
                break
            }
            case URL_PROJECT_USER_CHATS_ALL: {
                projectUserNotes('All')
                break
            }
            case URL_CHAT_DETAILS: {
                chatDetails()
                break
            }
            case URL_CHAT_DETAILS_PROPERTIES: {
                chatDetails(' - Properties')
                break
            }
            case URL_CHAT_DETAILS_NOTE: {
                chatDetails(' - Note')
                break
            }
        }
    }
}

export default URLsChats
