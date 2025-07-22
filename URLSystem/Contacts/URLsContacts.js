import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import HelperFunctions from '../../utils/HelperFunctions'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /projects/{projectId}/contacts/{userId}
 */
export const URL_CONTACT_DETAILS = 'CONTACT_DETAILS'

/**
 * /projects/{projectId}/contacts/{userId}/properties
 */
export const URL_CONTACT_DETAILS_PROPERTIES = 'CONTACT_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/contacts/{userId}/note
 */
export const URL_CONTACT_DETAILS_NOTE = 'CONTACT_DETAILS_NOTE'

/**
 * /projects/{projectId}/contacts/{userId}/chat
 */
export const URL_CONTACT_DETAILS_CHAT = 'CONTACT_DETAILS_CHAT'

/**
 * /projects/{projectId}/contacts/{userId}/updates
 */
export const URL_CONTACT_DETAILS_FEED = 'CONTACT_DETAILS_FEED'

/**
 * /projects/{projectId}/contacts/{userId}/backlinks/tasks
 */
export const URL_CONTACT_DETAILS_BACKLINKS_TASKS = 'CONTACT_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/contacts/{userId}/backlinks/notes
 */
export const URL_CONTACT_DETAILS_BACKLINKS_NOTES = 'CONTACT_DETAILS_BACKLINKS_NOTES'

/**
 * URL System for Contacts
 */
class URLsContacts {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsContacts.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsContacts.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsContacts.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsContacts.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_CONTACT_DETAILS:
                return `projects/${params[0]}/contacts/${params[1]}`
            case URL_CONTACT_DETAILS_PROPERTIES:
                return `projects/${params[0]}/contacts/${params[1]}/properties`
            case URL_CONTACT_DETAILS_NOTE:
                return `projects/${params[0]}/contacts/${params[1]}/note`
            case URL_CONTACT_DETAILS_CHAT:
                return `projects/${params[0]}/contacts/${params[1]}/chat`
            case URL_CONTACT_DETAILS_FEED:
                return `projects/${params[0]}/contacts/${params[1]}/updates`
            case URL_CONTACT_DETAILS_BACKLINKS_TASKS:
                return `projects/${params[0]}/contacts/${params[1]}/backlinks/tasks`
            case URL_CONTACT_DETAILS_BACKLINKS_NOTES:
                return `projects/${params[0]}/contacts/${params[1]}/backlinks/notes`
        }
    }

    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        switch (urlConstant) {
            case URL_CONTACT_DETAILS: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let contactName = ProjectHelper.getContactNameById(params[0], params[1], 'Contact')
                contactName = HelperFunctions.getFirstName(contactName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(contactName)} - Contact details`
                break
            }
            case URL_CONTACT_DETAILS_PROPERTIES: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let contactName = ProjectHelper.getContactNameById(params[0], params[1], 'Contact')
                contactName = HelperFunctions.getFirstName(contactName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    contactName
                )} - Contact details - Properties`
                break
            }
            case URL_CONTACT_DETAILS_NOTE: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let contactName = ProjectHelper.getContactNameById(params[0], params[1], 'Contact')
                contactName = HelperFunctions.getFirstName(contactName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    contactName
                )} - Contact details - Note`
                break
            }
            case URL_CONTACT_DETAILS_CHAT: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let contactName = ProjectHelper.getContactNameById(params[0], params[1], 'Contact')
                contactName = HelperFunctions.getFirstName(contactName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    contactName
                )} - Contact details - Chat`
                break
            }
            case URL_CONTACT_DETAILS_FEED: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let contactName = ProjectHelper.getContactNameById(params[0], params[1], 'Contact')
                contactName = HelperFunctions.getFirstName(contactName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    contactName
                )} - Contact details - Updates`
                break
            }
            case URL_CONTACT_DETAILS_BACKLINKS_TASKS: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let contactName = ProjectHelper.getContactNameById(params[0], params[1], 'Contact')
                contactName = HelperFunctions.getFirstName(contactName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    contactName
                )} - Contact details - Linked tasks`
                break
            }
            case URL_CONTACT_DETAILS_BACKLINKS_NOTES: {
                const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
                let contactName = ProjectHelper.getContactNameById(params[0], params[1], 'Contact')
                contactName = HelperFunctions.getFirstName(contactName)
                title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(
                    contactName
                )} - Contact details - Linked notes`
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsContacts
