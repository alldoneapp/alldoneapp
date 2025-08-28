import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import HelperFunctions from '../../utils/HelperFunctions'
import {
    DEFAULT_WORKSTREAM_ID,
    getWorkstreamById,
    WORKSTREAM_ID_PREFIX,
} from '../../components/Workstreams/WorkstreamHelper'
import { getAssistant } from '../../components/AdminPanel/Assistants/assistantsHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /
 */
export const URL_ROOT = 'ROOT'

/**
 * /projects/tasks
 */
export const URL_ALL_PROJECTS_TASKS = 'ALL_PROJECTS_TASKS'

/**
 * /projects/tasks/open
 */
export const URL_ALL_PROJECTS_TASKS_OPEN = 'ALL_PROJECTS_TASKS_OPEN'

/**
 * /projects/tasks/workflow
 */
export const URL_ALL_PROJECTS_TASKS_WORKFLOW = 'ALL_PROJECTS_TASKS_WORKFLOW'

/**
 * /projects/tasks/done
 */
export const URL_ALL_PROJECTS_TASKS_DONE = 'ALL_PROJECTS_TASKS_DONE'

/**
 * /projects/{projectId}/user/{userId}/tasks
 */
export const URL_PROJECT_USER_TASKS = 'PROJECT_TASKS'

/**
 * /projects/{projectId}/user/{userId}/tasks/open
 */
export const URL_PROJECT_USER_TASKS_OPEN = 'PROJECT_TASKS_OPEN'

/**
 * /projects/{projectId}/user/{userId}/tasks/workflow
 */
export const URL_PROJECT_USER_TASKS_WORKFLOW = 'PROJECT_TASKS_WORKFLOW'

/**
 * /projects/{projectId}/user/{userId}/tasks/inProgress
 */
export const URL_PROJECT_USER_TASKS_IN_PROGRESS = 'PROJECT_TASKS_IN_PROGRESS'

/**
 * /projects/{projectId}/user/{userId}/tasks/done
 */
export const URL_PROJECT_USER_TASKS_DONE = 'PROJECT_TASKS_DONE'

/**
 * /projects/{projectId}/tasks/{taskId}
 */
export const URL_TASK_DETAILS = 'TASK_DETAILS'

/**
 * /projects/{projectId}/tasks/{taskId}/updates
 */
export const URL_TASK_DETAILS_FEED = 'TASK_DETAILS_FEED'

/**
 * /projects/{projectId}/tasks/{taskId}/estimation
 */
export const URL_TASK_DETAILS_ESTIMATION = 'TASK_DETAILS_ESTIMATION'

/**
 * /projects/{projectId}/tasks/{taskId}/properties
 */
export const URL_TASK_DETAILS_PROPERTIES = 'TASK_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/tasks/{taskId}/chat
 */
export const URL_TASK_DETAILS_CHAT = 'TASK_DETAILS_CHAT'

/**
 * /projects/{projectId}/tasks/{taskId}/note
 */
export const URL_TASK_DETAILS_NOTE = 'TASK_DETAILS_NOTE'

/**
 * /projects/{projectId}/tasks/{taskId}/subtasks
 */
export const URL_TASK_DETAILS_SUBTASKS = 'TASK_DETAILS_SUBTASKS'

/**
 * /projects/{projectId}/tasks/{taskId}/backlinks/tasks
 */
export const URL_TASK_DETAILS_BACKLINKS_TASKS = 'TASK_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/tasks/{taskId}/backlinks/notes
 */
export const URL_TASK_DETAILS_BACKLINKS_NOTES = 'TASK_DETAILS_BACKLINKS_NOTES'

/**
 * URL System for Tasks
 */
class URLsTasks {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsTasks.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsTasks.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsTasks.getPath(urlConstant, ...params)

        if (!data || !data.noHistory) {
            URLSystem.setLastNavigationScreen(urlPath)
        }

        URLsTasks.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ALL_PROJECTS_TASKS:
                return `projects/tasks`
            case URL_ALL_PROJECTS_TASKS_OPEN:
                return `projects/tasks/open`
            case URL_ALL_PROJECTS_TASKS_WORKFLOW:
                return `projects/tasks/workflow`
            case URL_ALL_PROJECTS_TASKS_DONE:
                return `projects/tasks/done`
            case URL_PROJECT_USER_TASKS:
                return `projects/${params[0]}/user/${params[1]}/tasks`
            case URL_PROJECT_USER_TASKS_OPEN:
                return `projects/${params[0]}/user/${params[1]}/tasks/open`
            case URL_PROJECT_USER_TASKS_WORKFLOW:
                return `projects/${params[0]}/user/${params[1]}/tasks/workflow`
            case URL_PROJECT_USER_TASKS_IN_PROGRESS:
                return `projects/${params[0]}/user/${params[1]}/tasks/inProgress`
            case URL_PROJECT_USER_TASKS_DONE:
                return `projects/${params[0]}/user/${params[1]}/tasks/done`
            case URL_TASK_DETAILS:
                return `projects/${params[0]}/tasks/${params[1]}`
            case URL_TASK_DETAILS_FEED:
                return `projects/${params[0]}/tasks/${params[1]}/updates`
            case URL_TASK_DETAILS_ESTIMATION:
                return `projects/${params[0]}/tasks/${params[1]}/estimation`
            case URL_TASK_DETAILS_PROPERTIES:
                return `projects/${params[0]}/tasks/${params[1]}/properties`
            case URL_TASK_DETAILS_CHAT:
                return `projects/${params[0]}/tasks/${params[1]}/chat`
            case URL_TASK_DETAILS_SUBTASKS:
                return `projects/${params[0]}/tasks/${params[1]}/subtasks`
            case URL_TASK_DETAILS_BACKLINKS_TASKS:
                return `projects/${params[0]}/tasks/${params[1]}/backlinks/tasks`
            case URL_TASK_DETAILS_BACKLINKS_NOTES:
                return `projects/${params[0]}/tasks/${params[1]}/backlinks/notes`
            case URL_TASK_DETAILS_NOTE:
                return `projects/${params[0]}/tasks/${params[1]}/note`
        }
    }

    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        const projectUserTasks = () => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            let userName = ''

            if (params[1] === DEFAULT_WORKSTREAM_ID) {
                userName = 'Team'
            } else if (params[1].startsWith(WORKSTREAM_ID_PREFIX)) {
                userName = getWorkstreamById(params[0], params[1])?.displayName || 'Workstream'
            } else {
                const assistant = getAssistant(params[1])
                if (assistant) {
                    userName = assistant.displayName
                } else {
                    userName = ProjectHelper.getUserNameById(params[0], params[1], 'User')
                    userName = HelperFunctions.getFirstName(userName)
                }
            }
            title = `${prefix}${shrinkTagText(projectName)} - ${shrinkTagText(userName)} - Tasks`
        }

        const taskDetails = (titleSuffix = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            title = `${prefix}${shrinkTagText(projectName)} - Task details${titleSuffix}`
        }

        switch (urlConstant) {
            case URL_ALL_PROJECTS_TASKS: {
                title = `${prefix}All projects - Tasks`
                break
            }
            case URL_ALL_PROJECTS_TASKS_OPEN: {
                title = `${prefix}All projects - Open tasks`
                break
            }
            case URL_ALL_PROJECTS_TASKS_WORKFLOW: {
                title = `${prefix}All projects - Workflow tasks`
                break
            }
            case URL_ALL_PROJECTS_TASKS_DONE: {
                title = `${prefix}All projects - Done tasks`
                break
            }
            case URL_PROJECT_USER_TASKS: {
                projectUserTasks()
                break
            }
            case URL_PROJECT_USER_TASKS_OPEN: {
                projectUserTasks()
                break
            }
            case URL_PROJECT_USER_TASKS_WORKFLOW: {
                projectUserTasks()
                break
            }
            case URL_PROJECT_USER_TASKS_IN_PROGRESS: {
                projectUserTasks()
                break
            }
            case URL_PROJECT_USER_TASKS_DONE: {
                projectUserTasks()
                break
            }
            case URL_TASK_DETAILS: {
                taskDetails()
                break
            }
            case URL_TASK_DETAILS_FEED: {
                taskDetails(' - Updates')
                break
            }
            case URL_TASK_DETAILS_ESTIMATION: {
                taskDetails(' - Estimations')
                break
            }
            case URL_TASK_DETAILS_PROPERTIES: {
                taskDetails(' - Properties')
                break
            }
            case URL_TASK_DETAILS_CHAT: {
                taskDetails(' - Chat')
                break
            }
            case URL_TASK_DETAILS_NOTE: {
                taskDetails(' - Note')
                break
            }
            case URL_TASK_DETAILS_SUBTASKS: {
                taskDetails(' - Subtasks')
                break
            }
            case URL_TASK_DETAILS_BACKLINKS_TASKS: {
                taskDetails(' - Linked tasks')
                break
            }
            case URL_TASK_DETAILS_BACKLINKS_NOTES: {
                taskDetails(' - Linked notes')
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsTasks
