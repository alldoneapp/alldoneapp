import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /projects/{projectId}/skills/{skillId}
 */
export const URL_SKILL_DETAILS = 'SKILL_DETAILS'

/**
 * /projects/{projectId}/skills/{skillId}/properties
 */
export const URL_SKILL_DETAILS_PROPERTIES = 'SKILL_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/skills/{skillId}/properties
 */
export const URL_SKILL_DETAILS_NOTE = 'SKILL_DETAILS_NOTE'

/**
 * /projects/{projectId}/skills/{skillId}/chat
 */
export const URL_SKILL_DETAILS_CHAT = 'SKILL_DETAILS_CHAT'

/**
 * /projects/{projectId}/skills/{skillId}/backlinks/tasks
 */
export const URL_SKILL_DETAILS_BACKLINKS_TASKS = 'SKILL_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/skills/{skillId}/backlinks/notes
 */
export const URL_SKILL_DETAILS_BACKLINKS_NOTES = 'SKILL_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/skills/{skillId}/updates
 */
export const URL_SKILL_DETAILS_FEED = 'SKILL_DETAILS_FEED'

/**
 * URL System for Skills
 */
class URLsSkills {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsSkills.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsSkills.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsSkills.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsSkills.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_SKILL_DETAILS:
                return `projects/${params[0]}/skills/${params[1]}`
            case URL_SKILL_DETAILS_FEED:
                return `projects/${params[0]}/skills/${params[1]}/updates`
            case URL_SKILL_DETAILS_PROPERTIES:
                return `projects/${params[0]}/skills/${params[1]}/properties`
            case URL_SKILL_DETAILS_NOTE:
                return `projects/${params[0]}/skills/${params[1]}/note`
            case URL_SKILL_DETAILS_BACKLINKS_TASKS:
                return `projects/${params[0]}/skills/${params[1]}/backlinks/tasks`
            case URL_SKILL_DETAILS_BACKLINKS_NOTES:
                return `projects/${params[0]}/skills/${params[1]}/backlinks/notes`
            case URL_SKILL_DETAILS_CHAT:
                return `projects/${params[0]}/skills/${params[1]}/chat`
        }
    }

    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        const skillDetails = (titleSuffix = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            title = `${prefix}${shrinkTagText(projectName)} - Skill details${titleSuffix}`
        }

        switch (urlConstant) {
            case URL_SKILL_DETAILS: {
                skillDetails()
                break
            }
            case URL_SKILL_DETAILS_FEED: {
                skillDetails(' - Updates')
                break
            }
            case URL_SKILL_DETAILS_PROPERTIES: {
                skillDetails(' - Properties')
                break
            }
            case URL_SKILL_DETAILS_NOTE: {
                skillDetails(' - Note')
                break
            }
            case URL_SKILL_DETAILS_CHAT: {
                skillDetails(' - Chat')
                break
            }
            case URL_SKILL_DETAILS_BACKLINKS_TASKS: {
                skillDetails(' - Linked tasks')
                break
            }
            case URL_SKILL_DETAILS_BACKLINKS_NOTES: {
                skillDetails(' - Linked notes')
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsSkills
