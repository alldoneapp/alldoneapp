import { GLOBAL_PROJECT_ID } from '../../components/AdminPanel/Assistants/assistantsHelper'
import { getProjectData } from '../../utils/backends/firestore'
import URLSystem from '../URLSystem'

/**
 * /projects/{projectId}/assistants/{assistantId}
 */
export const URL_ASSISTANT_DETAILS = 'ASSISTANT_DETAILS'

/**
 * /projects/{projectId}/assistants/{assistantId}/customizations
 */
export const URL_ASSISTANT_DETAILS_CUSTOMIZATIONS = 'ASSISTANT_DETAILS_CUSTOMIZATIONS'

/**
 * /projects/{projectId}/assistants/{assistantId}/backlinks/tasks
 */
export const URL_ASSISTANT_DETAILS_BACKLINKS_TASKS = 'ASSISTANT_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/assistants/{assistantId}/backlinks/notes
 */
export const URL_ASSISTANT_DETAILS_BACKLINKS_NOTES = 'ASSISTANT_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/assistants/{assistantId}/note
 */
export const URL_ASSISTANT_DETAILS_NOTE = 'ASSISTANT_DETAILS_NOTE'

/**
 * /projects/{projectId}/assistants/{assistantId}/chat
 */
export const URL_ASSISTANT_DETAILS_CHAT = 'ASSISTANT_DETAILS_CHAT'

/**
 * /projects/{projectId}/assistants/{assistantId}/updates
 */
export const URL_ASSISTANT_DETAILS_UPDATES = 'ASSISTANT_DETAILS_UPDATES'

/**
 * URL System for Aissistants
 */
class URLsAssistants {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsAssistants.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsAssistants.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsAssistants.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsAssistants.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ASSISTANT_DETAILS:
                return `projects/${params[0]}/assistants/${params[1]}`
            case URL_ASSISTANT_DETAILS_CUSTOMIZATIONS:
                return `projects/${params[0]}/assistants/${params[1]}/customizations`
            case URL_ASSISTANT_DETAILS_BACKLINKS_TASKS:
                return `projects/${params[0]}/assistants/${params[1]}/backlinks/tasks`
            case URL_ASSISTANT_DETAILS_BACKLINKS_NOTES:
                return `projects/${params[0]}/assistants/${params[1]}/backlinks/notes`
            case URL_ASSISTANT_DETAILS_NOTE:
                return `projects/${params[0]}/assistants/${params[1]}/note`
            case URL_ASSISTANT_DETAILS_CHAT:
                return `projects/${params[0]}/assistants/${params[1]}/chat`
            case URL_ASSISTANT_DETAILS_UPDATES:
                return `projects/${params[0]}/assistants/${params[1]}/updates`
        }
    }

    static setTitle = async (urlConstant, internal = false, ...params) => {
        const projectId = params[0]
        const project = projectId === GLOBAL_PROJECT_ID ? { name: 'Admin' } : await getProjectData(projectId)

        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        const assistantDetails = (titleSuffix = '') => {
            const projectName = project ? project.name : 'Project'
            title = `${prefix}${projectName} - Assistant details${titleSuffix}`
        }

        switch (urlConstant) {
            case URL_ASSISTANT_DETAILS: {
                assistantDetails()
                break
            }
            case URL_ASSISTANT_DETAILS_CUSTOMIZATIONS: {
                assistantDetails(' - Customizations')
                break
            }
            case URL_ASSISTANT_DETAILS_BACKLINKS_TASKS: {
                assistantDetails(' - Linked tasks')
                break
            }
            case URL_ASSISTANT_DETAILS_BACKLINKS_NOTES: {
                assistantDetails(' - Linked notes')
                break
            }
            case URL_ASSISTANT_DETAILS_NOTE: {
                assistantDetails(' - Note')
                break
            }
            case URL_ASSISTANT_DETAILS_CHAT: {
                assistantDetails(' - Chat')
                break
            }
            case URL_ASSISTANT_DETAILS_UPDATES: {
                assistantDetails(' - Updates')
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsAssistants
