import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /project/{projectId}
 */
export const URL_PROJECT_DETAILS = 'PROJECT_DETAILS'

/**
 * /project/{projectId}/properties
 */
export const URL_PROJECT_DETAILS_PROPERTIES = 'PROJECT_DETAILS_PROPERTIES'

/**
 * /project/{projectId}/members
 */
export const URL_PROJECT_DETAILS_MEMBERS = 'PROJECT_DETAILS_MEMBERS'

/**
 * /project/{projectId}/assistants
 */
export const URL_PROJECT_DETAILS_ASSISTANTS = 'PROJECT_DETAILS_ASSISTANTS'

/**
 * /project/{projectId}/workstreams
 */
export const URL_PROJECT_DETAILS_WORKSTREAMS = 'PROJECT_DETAILS_WORKSTREAMS'

/**
 * /project/{projectId}/backlinks/tasks
 */
export const URL_PROJECT_DETAILS_BACKLINKS_TASKS = 'PROJECT_DETAILS_BACKLINKS_TASKS'

/**
 * /project/{projectId}/backlinks/notes
 */
export const URL_PROJECT_DETAILS_BACKLINKS_NOTES = 'PROJECT_DETAILS_BACKLINKS_NOTES'

/**
 * /project/{projectId}/updates
 */
export const URL_PROJECT_DETAILS_FEED = 'PROJECT_DETAILS_FEED'

/**
 * /project/{projectId}/statistics
 */
export const URL_PROJECT_DETAILS_STATISTICS = 'PROJECT_DETAILS_STATISTICS'

/**
 * /project/{projectId}/archive
 */
export const URL_PROJECT_ARCHIVE = 'PROJECT_ARCHIVE'

/**
 * /project/{projectId}/unarchive
 */
export const URL_PROJECT_UNARCHIVE = 'PROJECT_UNARCHIVE'

/**
 * URL System for Projects
 */
class URLsProjects {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsProjects.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsProjects.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsProjects.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsProjects.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_PROJECT_DETAILS:
                return `project/${params[0]}`
            case URL_PROJECT_DETAILS_PROPERTIES:
                return `project/${params[0]}/properties`
            case URL_PROJECT_DETAILS_MEMBERS:
                return `project/${params[0]}/members`
            case URL_PROJECT_DETAILS_WORKSTREAMS:
                return `project/${params[0]}/workstreams`
            case URL_PROJECT_DETAILS_BACKLINKS_TASKS:
                return `project/${params[0]}/backlinks/tasks`
            case URL_PROJECT_DETAILS_BACKLINKS_NOTES:
                return `project/${params[0]}/backlinks/notes`
            case URL_PROJECT_DETAILS_FEED:
                return `project/${params[0]}/updates`
            case URL_PROJECT_DETAILS_STATISTICS:
                return `project/${params[0]}/statistics`
            case URL_PROJECT_DETAILS_ASSISTANTS:
                return `project/${params[0]}/assistants`
        }
    }

    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        const projectDetails = (titleSuffix = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            title = `${prefix}${shrinkTagText(projectName)} - Project details${titleSuffix}`
        }

        switch (urlConstant) {
            case URL_PROJECT_DETAILS: {
                projectDetails()
                break
            }
            case URL_PROJECT_DETAILS_PROPERTIES: {
                projectDetails(' - Properties')
                break
            }
            case URL_PROJECT_DETAILS_MEMBERS: {
                projectDetails(' - Members')
                break
            }
            case URL_PROJECT_DETAILS_ASSISTANTS: {
                projectDetails(' - Assistants')
                break
            }
            case URL_PROJECT_DETAILS_WORKSTREAMS: {
                projectDetails(' - Workstreams')
                break
            }
            case URL_PROJECT_DETAILS_BACKLINKS_TASKS: {
                projectDetails(' - Linked tasks')
                break
            }
            case URL_PROJECT_DETAILS_BACKLINKS_NOTES: {
                projectDetails(' - Linked notes')
                break
            }
            case URL_PROJECT_DETAILS_FEED: {
                projectDetails(' - Updates')
                break
            }
            case URL_PROJECT_DETAILS_STATISTICS: {
                projectDetails(' - Statistics')
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsProjects
