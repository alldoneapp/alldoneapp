const ParsingTextHelper = require('../../ParsingTextHelper')
const { getContactData } = require('../../Firestore/contactsFirestore')
const { getAssistantData, GLOBAL_PROJECT_ID } = require('../../Firestore/assistantsFirestore')
const { getUserData } = require('../../Users/usersFirestore')
const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /projects/tasks
 */
const URL_ALL_PROJECTS_TASKS = 'ALL_PROJECTS_TASKS'

/**
 * /projects/tasks/open
 */
const URL_ALL_PROJECTS_TASKS_OPEN = 'ALL_PROJECTS_TASKS_OPEN'

/**
 * /projects/tasks/workflow
 */
const URL_ALL_PROJECTS_TASKS_WORKFLOW = 'ALL_PROJECTS_TASKS_WORKFLOW'

/**
 * /projects/tasks/done
 */
const URL_ALL_PROJECTS_TASKS_DONE = 'ALL_PROJECTS_TASKS_DONE'

/**
 * /projects/{projectId}/user/{userId}/tasks
 */
const URL_PROJECT_USER_TASKS = 'PROJECT_TASKS'

/**
 * /projects/{projectId}/user/{userId}/tasks/open
 */
const URL_PROJECT_USER_TASKS_OPEN = 'PROJECT_TASKS_OPEN'

/**
 * /projects/{projectId}/user/{userId}/tasks/workflow
 */
const URL_PROJECT_USER_TASKS_WORKFLOW = 'PROJECT_TASKS_WORKFLOW'

/**
 * /projects/{projectId}/user/{userId}/tasks/inProgress
 */
const URL_PROJECT_USER_TASKS_IN_PROGRESS = 'PROJECT_TASKS_IN_PROGRESS'

/**
 * /projects/{projectId}/user/{userId}/tasks/done
 */
const URL_PROJECT_USER_TASKS_DONE = 'PROJECT_TASKS_DONE'

/**
 * /projects/{projectId}/tasks/{taskId}
 */
const URL_TASK_DETAILS = 'TASK_DETAILS'

/**
 * /projects/{projectId}/tasks/{taskId}/updates
 */
const URL_TASK_DETAILS_FEED = 'TASK_DETAILS_FEED'

/**
 * /projects/{projectId}/tasks/{taskId}/estimation
 */
const URL_TASK_DETAILS_ESTIMATION = 'TASK_DETAILS_ESTIMATION'

/**
 * /projects/{projectId}/tasks/{taskId}/properties
 */
const URL_TASK_DETAILS_PROPERTIES = 'TASK_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/tasks/{taskId}/chat
 */
const URL_TASK_DETAILS_CHAT = 'TASK_DETAILS_CHAT'

/**
 * /projects/{projectId}/tasks/{taskId}/subtasks
 */
const URL_TASK_DETAILS_SUBTASKS = 'TASK_DETAILS_SUBTASKS'

/**
 * /projects/{projectId}/tasks/{taskId}/backlinks/tasks
 */
const URL_TASK_DETAILS_BACKLINKS_TASKS = 'TASK_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/tasks/{taskId}/backlinks/notes
 */
const URL_TASK_DETAILS_BACKLINKS_NOTES = 'TASK_DETAILS_BACKLINKS_NOTES'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_ALL_PROJECTS_TASKS]: new RegExp('^/projects/tasks$'),
    [URL_ALL_PROJECTS_TASKS_OPEN]: new RegExp('^/projects/tasks/open$'),
    [URL_ALL_PROJECTS_TASKS_WORKFLOW]: new RegExp('^/projects/tasks/workflow$'),
    [URL_ALL_PROJECTS_TASKS_DONE]: new RegExp('^/projects/tasks/done$'),
    [URL_PROJECT_USER_TASKS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/tasks$'),
    [URL_PROJECT_USER_TASKS_OPEN]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/tasks/open$'),
    [URL_PROJECT_USER_TASKS_WORKFLOW]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/tasks/workflow$'
    ),
    [URL_PROJECT_USER_TASKS_IN_PROGRESS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/tasks/inProgress$'
    ),
    [URL_PROJECT_USER_TASKS_DONE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/tasks/done$'),
    [URL_TASK_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)$'),
    [URL_TASK_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/updates$'),
    [URL_TASK_DETAILS_ESTIMATION]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/estimation$'),
    [URL_TASK_DETAILS_PROPERTIES]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/properties$'),
    [URL_TASK_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/chat$'),
    [URL_TASK_DETAILS_SUBTASKS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/subtasks$'),
    [URL_TASK_DETAILS_BACKLINKS_TASKS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/backlinks/tasks$'
    ),
    [URL_TASK_DETAILS_BACKLINKS_NOTES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/backlinks/notes$'
    ),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    const projectUserTasks = async (type = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(getUserData(params.userId))
        promises.push(getContactData(admin.firestore(), params.projectId, params.userId))
        promises.push(getAssistantData(admin, params.projectId, params.userId))
        promises.push(getAssistantData(admin, GLOBAL_PROJECT_ID, params.userId))
        const results = await Promise.all(promises)
        const project = results[0].exists ? results[0].data() : null
        const user = results[1]
        const contact = results[2]
        const assistant = results[3]
        const globalAssistant = results[4]

        const projectName = (project && project.name) || 'Project'
        const userName =
            (user && user.displayName) ||
            (contact && contact.displayName) ||
            (assistant && assistant.displayName) ||
            (globalAssistant && globalAssistant.displayName) ||
            'User'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - ${shrinkTagText(userName)} - Tasks`
        data.description = `Alldone.app. List of ${type} tasks that belongs to ${userName} in the project ${projectName}`
    }

    const taskDetails = async (titleSuffix = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(admin.firestore().doc(`items/${params.projectId}/tasks/${params.taskId}`).get())
        const groups = await Promise.all(promises)
        const project = groups[0].exists ? groups[0].data() : null
        const task = groups[1].exists ? groups[1].data() : null

        const projectName = (project && project.name) || 'Project'
        const taskName =
            (task && ParsingTextHelper.getObjectNameWithoutMeta(task.extendedName || task.name)) || 'Task name...'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Task details${titleSuffix}`
        data.description = `Alldone.app. Task description: ${taskName}`
    }

    switch (urlConstant) {
        case URL_ALL_PROJECTS_TASKS: {
            data.title = `Alldone.app - All projects - Tasks`
            data.description = 'Alldone.app. List of tasks for all projects'
            break
        }
        case URL_ALL_PROJECTS_TASKS_OPEN: {
            data.title = `Alldone.app - All projects - Open tasks`
            data.description = 'Alldone.app. List of open tasks for all projects'
            break
        }
        case URL_ALL_PROJECTS_TASKS_WORKFLOW: {
            data.title = `Alldone.app - All projects - Workflow tasks`
            data.description = 'Alldone.app. List of workflow tasks for all projects'
            break
        }
        case URL_ALL_PROJECTS_TASKS_DONE: {
            data.title = `Alldone.app - All projects - Done tasks`
            data.description = 'Alldone.app. List of done tasks for all projects'
            break
        }
        case URL_PROJECT_USER_TASKS: {
            await projectUserTasks()
            break
        }
        case URL_PROJECT_USER_TASKS_OPEN: {
            await projectUserTasks('open')
            break
        }
        case URL_PROJECT_USER_TASKS_WORKFLOW: {
            await projectUserTasks('workflow')
            break
        }
        case URL_PROJECT_USER_TASKS_IN_PROGRESS: {
            await projectUserTasks('in progress')
            break
        }
        case URL_PROJECT_USER_TASKS_DONE: {
            await projectUserTasks('done')
            break
        }
        case URL_TASK_DETAILS: {
            await taskDetails()
            break
        }
        case URL_TASK_DETAILS_FEED: {
            await taskDetails(' - Updates')
            break
        }
        case URL_TASK_DETAILS_ESTIMATION: {
            await taskDetails(' - Estimations')
            break
        }
        case URL_TASK_DETAILS_PROPERTIES: {
            await taskDetails(' - Properties')
            break
        }
        case URL_TASK_DETAILS_CHAT: {
            await taskDetails(' - Chat')
            break
        }
        case URL_TASK_DETAILS_SUBTASKS: {
            await taskDetails(' - Subtasks')
            break
        }
        case URL_TASK_DETAILS_BACKLINKS_TASKS: {
            await taskDetails(' - Linked tasks')
            break
        }
        case URL_TASK_DETAILS_BACKLINKS_NOTES: {
            await taskDetails(' - Linked notes')
            break
        }
    }

    return data
}

module.exports = {
    URL_ALL_PROJECTS_TASKS,
    URL_ALL_PROJECTS_TASKS_OPEN,
    URL_ALL_PROJECTS_TASKS_WORKFLOW,
    URL_ALL_PROJECTS_TASKS_DONE,
    URL_PROJECT_USER_TASKS,
    URL_PROJECT_USER_TASKS_OPEN,
    URL_PROJECT_USER_TASKS_WORKFLOW,
    URL_PROJECT_USER_TASKS_IN_PROGRESS,
    URL_PROJECT_USER_TASKS_DONE,
    URL_TASK_DETAILS,
    URL_TASK_DETAILS_FEED,
    URL_TASK_DETAILS_ESTIMATION,
    URL_TASK_DETAILS_PROPERTIES,
    URL_TASK_DETAILS_CHAT,
    URL_TASK_DETAILS_SUBTASKS,
    URL_TASK_DETAILS_BACKLINKS_TASKS,
    URL_TASK_DETAILS_BACKLINKS_NOTES,
    regexList,
    getMetadata,
}
