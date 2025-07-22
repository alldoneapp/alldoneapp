import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import HelperFunctions from '../../utils/HelperFunctions'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /projects/contacts/all
 */
export const URL_ALL_PROJECTS_PEOPLE_ALL = 'ALL_PROJECTS_PEOPLE_ALL'

/**
 * /projects/contacts/followed
 */
export const URL_ALL_PROJECTS_PEOPLE_FOLLOWED = 'ALL_PROJECTS_PEOPLE_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/contacts/all
 */
export const URL_PROJECT_PEOPLE_ALL = 'PROJECT_PEOPLE_ALL'

/**
 * /projects/{projectId}/user/{userId}/contacts/followed
 */
export const URL_PROJECT_PEOPLE_FOLLOWED = 'PROJECT_PEOPLE_FOLLOWED'

/**
 * /projects/{projectId}/contacts/{userId}
 */
export const URL_PEOPLE_DETAILS = 'PEOPLE_DETAILS'

/**
 * /projects/{projectId}/contacts/{userId}/updates
 */
export const URL_PEOPLE_DETAILS_FEED = 'PEOPLE_DETAILS_FEED'

/**
 * /projects/{projectId}/contacts/{userId}/workflow
 */
export const URL_PEOPLE_DETAILS_WORKFLOW = 'PEOPLE_DETAILS_WORKFLOW'

/**
 * /projects/{projectId}/contacts/{userId}/properties
 */
export const URL_PEOPLE_DETAILS_PROPERTIES = 'PEOPLE_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/contacts/{userId}/profile
 */
export const URL_PEOPLE_DETAILS_PROFILE = 'PEOPLE_DETAILS_PROFILE'

/**
 * /projects/{projectId}/contacts/{userId}/note
 */
export const URL_PEOPLE_DETAILS_NOTE = 'PEOPLE_DETAILS_NOTE'

/**
 * /projects/{projectId}/contacts/{userId}/chat
 */
export const URL_PEOPLE_DETAILS_CHAT = 'PEOPLE_DETAILS_CHAT'

/**
 * /projects/{projectId}/contacts/{userId}/statistics
 */
export const URL_PEOPLE_DETAILS_STATISTICS = 'PEOPLE_DETAILS_STATISTICS'

/**
 * /projects/{projectId}/contacts/{userId}/backlinks/tasks
 */
export const URL_PEOPLE_DETAILS_BACKLINKS_TASKS = 'PEOPLE_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/contacts/{userId}/backlinks/notes
 */
export const URL_PEOPLE_DETAILS_BACKLINKS_NOTES = 'PEOPLE_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/contacts/{userId|email}/add
 */
export const URL_PROJECT_PEOPLE_ADD = 'PROJECT_PEOPLE_ADD'

/**
 * URL System for Contacts
 */
class URLsPeople {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsPeople.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsPeople.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsPeople.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsPeople.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ALL_PROJECTS_PEOPLE_ALL:
                return `projects/contacts/all`
            case URL_ALL_PROJECTS_PEOPLE_FOLLOWED:
                return `projects/contacts/followed`
            case URL_PROJECT_PEOPLE_ALL:
                return `projects/${params[0]}/user/${params[1]}/contacts/all`
            case URL_PROJECT_PEOPLE_FOLLOWED:
                return `projects/${params[0]}/user/${params[1]}/contacts/followed`
            case URL_PEOPLE_DETAILS:
                return `projects/${params[0]}/contacts/${params[1]}`
            case URL_PEOPLE_DETAILS_FEED:
                return `projects/${params[0]}/contacts/${params[1]}/updates`
            case URL_PEOPLE_DETAILS_WORKFLOW:
                return `projects/${params[0]}/contacts/${params[1]}/workflow`
            case URL_PEOPLE_DETAILS_PROPERTIES:
                return `projects/${params[0]}/contacts/${params[1]}/properties`
            case URL_PEOPLE_DETAILS_PROFILE:
                return `projects/${params[0]}/contacts/${params[1]}/profile`
            case URL_PEOPLE_DETAILS_NOTE:
                return `projects/${params[0]}/contacts/${params[1]}/note`
            case URL_PEOPLE_DETAILS_CHAT:
                return `projects/${params[0]}/contacts/${params[1]}/chat`
            case URL_PEOPLE_DETAILS_STATISTICS:
                return `projects/${params[0]}/contacts/${params[1]}/statistics`
            case URL_PEOPLE_DETAILS_BACKLINKS_TASKS:
                return `projects/${params[0]}/contacts/${params[1]}/backlinks/tasks`
            case URL_PEOPLE_DETAILS_BACKLINKS_NOTES:
                return `projects/${params[0]}/contacts/${params[1]}/backlinks/notes`
            case URL_PROJECT_PEOPLE_ADD:
                return `projects/${params[0]}/contacts/${params[1]}/add`
        }
    }

    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        switch (urlConstant) {
            case URL_ALL_PROJECTS_PEOPLE_ALL: {
                title = `${prefix}All projects - All Contacts`
                break
            }
            case URL_ALL_PROJECTS_PEOPLE_FOLLOWED: {
                title = `${prefix}All projects - Followed Contacts`
                break
            }
            case URL_PROJECT_PEOPLE_ALL: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                title = `${prefix}${shrinkTagText(projectName)} - All Contacts`
                break
            }
            case URL_PROJECT_PEOPLE_FOLLOWED: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                title = `${prefix}${shrinkTagText(projectName)} - Followed Contacts`
                break
            }
            case URL_PEOPLE_DETAILS: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(userName)} - Contact details`
                break
            }
            case URL_PEOPLE_DETAILS_FEED: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    userName
                )} - Contact details - Updates`
                break
            }
            case URL_PEOPLE_DETAILS_WORKFLOW: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    userName
                )} - Contact details - Workflow`
                break
            }
            case URL_PEOPLE_DETAILS_PROPERTIES: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    userName
                )} - Contact details - Properties`
                break
            }
            case URL_PEOPLE_DETAILS_PROFILE: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    userName
                )} - Contact details - Profile`
                break
            }
            case URL_PEOPLE_DETAILS_NOTE: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(userName)} - Contact details - Note`
                break
            }
            case URL_PEOPLE_DETAILS_CHAT: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(userName)} - Contact details - Chat`
                break
            }
            case URL_PEOPLE_DETAILS_STATISTICS: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    userName
                )} - Contact details - Statistics`
                break
            }
            case URL_PEOPLE_DETAILS_BACKLINKS_TASKS: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    userName
                )} - Contact details - Linked tasks`
                break
            }
            case URL_PEOPLE_DETAILS_BACKLINKS_NOTES: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                userName = HelperFunctions.getFirstName(userName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    userName
                )} - Contact details - Linked notes`
                break
            }
            case URL_PROJECT_PEOPLE_ADD: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                title = `${prefix}${shrinkTagText(projectName)} - Add contact`
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsPeople
