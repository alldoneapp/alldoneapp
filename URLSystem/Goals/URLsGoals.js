import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /projects/goals
 */
export const URL_ALL_PROJECTS_GOALS = 'ALL_PROJECTS_GOALS'

/**
 * /projects/goals/open
 */
export const URL_ALL_PROJECTS_GOALS_OPEN = 'ALL_PROJECTS_GOALS_OPEN'

/**
 * /projects/goals/done
 */
export const URL_ALL_PROJECTS_GOALS_DONE = 'ALL_PROJECTS_GOALS_DONE'

/**
 * /projects/{projectId}/user/{userId}/goals
 */
export const URL_PROJECT_USER_GOALS = 'PROJECT_USER_GOALS'

/**
 * /projects/{projectId}/user/{userId}/goals/followed
 */
export const URL_PROJECT_USER_GOALS_OPEN = 'PROJECT_USER_GOALS_OPEN'

/**
 * /projects/{projectId}/user/{userId}/goals/all
 */
export const URL_PROJECT_USER_GOALS_DONE = 'PROJECT_USER_GOALS_DONE'

/**
 * /projects/{projectId}/goals/{goalId}
 */
export const URL_GOAL_DETAILS = 'GOAL_DETAILS'

/**
 * /projects/{projectId}/goals/{goalId}/properties
 */
export const URL_GOAL_DETAILS_PROPERTIES = 'GOAL_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/goals/{goalId}/properties
 */
export const URL_GOAL_DETAILS_NOTE = 'GOAL_DETAILS_NOTE'

/**
 * /projects/{projectId}/goals/{goalId}/chat
 */
export const URL_GOAL_DETAILS_CHAT = 'GOAL_DETAILS_CHAT'

/**
 * /projects/{projectId}/goals/{goalId}/tasks
 */
export const URL_GOAL_DETAILS_LINKED_TASKS = 'GOAL_DETAILS_LINKED_TASKS'

/**
 * /projects/{projectId}/goals/{goalId}/tasks/open
 */
export const URL_GOAL_DETAILS_TASKS_OPEN = 'URL_GOAL_DETAILS_TASKS_OPEN'

/**
 * /projects/{projectId}/goals/{goalId}/tasks/workflow
 */
export const URL_GOAL_DETAILS_TASKS_WORKFLOW = 'URL_GOAL_DETAILS_TASKS_WORKFLOW'

/**
 * /projects/{projectId}/goals/{goalId}/tasks/done
 */
export const URL_GOAL_DETAILS_TASKS_DONE = 'URL_GOAL_DETAILS_TASKS_DONE'

/**
 * /projects/{projectId}/goals/{goalId}/backlinks/tasks
 */
export const URL_GOAL_DETAILS_BACKLINKS_TASKS = 'GOAL_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/goals/{goalId}/backlinks/notes
 */
export const URL_GOAL_DETAILS_BACKLINKS_NOTES = 'GOAL_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/goals/{goalId}/updates
 */
export const URL_GOAL_DETAILS_FEED = 'GOAL_DETAILS_FEED'

/**
 * URL System for Goals
 */
class URLsGoals {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsGoals.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsGoals.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsGoals.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsGoals.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ALL_PROJECTS_GOALS:
                return `projects/goals/open`
            case URL_ALL_PROJECTS_GOALS_OPEN:
                return `projects/goals/open`
            case URL_ALL_PROJECTS_GOALS_DONE:
                return `projects/goals/done`
            case URL_PROJECT_USER_GOALS:
                return `projects/${params[0]}/user/${params[1]}/goals/open`
            case URL_PROJECT_USER_GOALS_OPEN:
                return `projects/${params[0]}/user/${params[1]}/goals/open`
            case URL_PROJECT_USER_GOALS_DONE:
                return `projects/${params[0]}/user/${params[1]}/goals/done`
            case URL_GOAL_DETAILS:
                return `projects/${params[0]}/goals/${params[1]}`
            case URL_GOAL_DETAILS_FEED:
                return `projects/${params[0]}/goals/${params[1]}/updates`
            case URL_GOAL_DETAILS_PROPERTIES:
                return `projects/${params[0]}/goals/${params[1]}/properties`
            case URL_GOAL_DETAILS_NOTE:
                return `projects/${params[0]}/goals/${params[1]}/note`
            case URL_GOAL_DETAILS_BACKLINKS_TASKS:
                return `projects/${params[0]}/goals/${params[1]}/backlinks/tasks`
            case URL_GOAL_DETAILS_BACKLINKS_NOTES:
                return `projects/${params[0]}/goals/${params[1]}/backlinks/notes`
            case URL_GOAL_DETAILS_CHAT:
                return `projects/${params[0]}/goals/${params[1]}/chat`
            case URL_GOAL_DETAILS_LINKED_TASKS:
                return `projects/${params[0]}/goals/${params[1]}/tasks`
            case URL_GOAL_DETAILS_TASKS_OPEN:
                return `projects/${params[0]}/goals/${params[1]}/tasks/open`
            case URL_GOAL_DETAILS_TASKS_WORKFLOW:
                return `projects/${params[0]}/goals/${params[1]}/tasks/workflow`
            case URL_GOAL_DETAILS_TASKS_DONE:
                return `projects/${params[0]}/goals/${params[1]}/tasks/done`
        }
    }

    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        const projectUserGoals = (pre = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            title = `${prefix}${shrinkTagText(projectName)} - ${pre} Goals`
        }

        const goalDetails = (titleSuffix = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            title = `${prefix}${shrinkTagText(projectName)} - Goal details${titleSuffix}`
        }

        switch (urlConstant) {
            case URL_ALL_PROJECTS_GOALS: {
                title = `${prefix}All projects - Goals`
                break
            }
            case URL_ALL_PROJECTS_GOALS_OPEN: {
                title = `${prefix}All projects - Open Goals`
                break
            }
            case URL_ALL_PROJECTS_GOALS_DONE: {
                title = `${prefix}All projects - Done Goals`
                break
            }
            case URL_PROJECT_USER_GOALS_OPEN: {
                projectUserGoals('Open')
                break
            }
            case URL_PROJECT_USER_GOALS_DONE: {
                projectUserGoals('Done')
                break
            }
            case URL_GOAL_DETAILS: {
                goalDetails()
                break
            }
            case URL_GOAL_DETAILS_FEED: {
                goalDetails(' - Updates')
                break
            }
            case URL_GOAL_DETAILS_PROPERTIES: {
                goalDetails(' - Properties')
                break
            }
            case URL_GOAL_DETAILS_NOTE: {
                goalDetails(' - Note')
                break
            }
            case URL_GOAL_DETAILS_CHAT: {
                goalDetails(' - Chat')
                break
            }
            case URL_GOAL_DETAILS_LINKED_TASKS: {
                goalDetails(' - Tasks')
                break
            }
            case URL_GOAL_DETAILS_BACKLINKS_TASKS: {
                goalDetails(' - Linked tasks')
                break
            }
            case URL_GOAL_DETAILS_BACKLINKS_NOTES: {
                goalDetails(' - Linked notes')
                break
            }
            case URL_GOAL_DETAILS_TASKS_OPEN: {
                goalDetails(' - Tasks')
                break
            }
            case URL_GOAL_DETAILS_TASKS_WORKFLOW: {
                goalDetails(' - Tasks')
                break
            }
            case URL_GOAL_DETAILS_TASKS_DONE: {
                goalDetails(' - Tasks')
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsGoals
