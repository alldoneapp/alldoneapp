const ParsingTextHelper = require('../../ParsingTextHelper')
const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /projects/goals
 */
const URL_ALL_PROJECTS_GOALS = 'ALL_PROJECTS_GOALS'

/**
 * /projects/goals/open
 */
const URL_ALL_PROJECTS_GOALS_OPEN = 'ALL_PROJECTS_GOALS_OPEN'

/**
 * /projects/goals/done
 */
const URL_ALL_PROJECTS_GOALS_DONE = 'ALL_PROJECTS_GOALS_DONE'

/**
 * /projects/{projectId}/user/{userId}/goals
 */
const URL_PROJECT_USER_GOALS = 'PROJECT_USER_GOALS'

/**
 * /projects/{projectId}/user/{userId}/goals/followed
 */
const URL_PROJECT_USER_GOALS_OPEN = 'PROJECT_USER_GOALS_OPEN'

/**
 * /projects/{projectId}/user/{userId}/goals/all
 */
const URL_PROJECT_USER_GOALS_DONE = 'PROJECT_USER_GOALS_DONE'

/**
 * /projects/{projectId}/goals/{goalId}
 */
const URL_GOAL_DETAILS = 'GOAL_DETAILS'

/**
 * /projects/{projectId}/goals/{goalId}/properties
 */
const URL_GOAL_DETAILS_PROPERTIES = 'GOAL_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/goals/{goalId}/chat
 */
const URL_GOAL_DETAILS_CHAT = 'GOAL_DETAILS_CHAT'

/**
 * /projects/{projectId}/goals/{goalId}/tasks/open
 */
const URL_GOAL_DETAILS_TASKS_OPEN = 'URL_GOAL_DETAILS_TASKS_OPEN'

/**
 * /projects/{projectId}/goals/{goalId}/tasks/workflow
 */
const URL_GOAL_DETAILS_TASKS_WORKFLOW = 'URL_GOAL_DETAILS_TASKS_WORKFLOW'

/**
 * /projects/{projectId}/goals/{goalId}/tasks/done
 */
const URL_GOAL_DETAILS_TASKS_DONE = 'URL_GOAL_DETAILS_TASKS_DONE'

/**
 * /projects/{projectId}/goals/{goalId}/backlinks/tasks
 */
const URL_GOAL_DETAILS_BACKLINKS_TASKS = 'GOAL_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/goals/{goalId}/backlinks/notes
 */
const URL_GOAL_DETAILS_BACKLINKS_NOTES = 'GOAL_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/goals/{goalId}/updates
 */
const URL_GOAL_DETAILS_FEED = 'GOAL_DETAILS_FEED'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_ALL_PROJECTS_GOALS]: new RegExp('^/projects/goals$'),
    [URL_ALL_PROJECTS_GOALS_OPEN]: new RegExp('^/projects/goals/open$'),
    [URL_ALL_PROJECTS_GOALS_DONE]: new RegExp('^/projects/goals/done$'),
    [URL_PROJECT_USER_GOALS_OPEN]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/goals/open$'),
    [URL_PROJECT_USER_GOALS_DONE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/goals/done$'),

    [URL_GOAL_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)$'),
    [URL_GOAL_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/updates$'),
    [URL_GOAL_DETAILS_PROPERTIES]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/properties$'),
    [URL_GOAL_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/chat$'),
    [URL_GOAL_DETAILS_BACKLINKS_TASKS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/backlinks/tasks$'
    ),
    [URL_GOAL_DETAILS_BACKLINKS_NOTES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/backlinks/notes$'
    ),
    [URL_GOAL_DETAILS_TASKS_OPEN]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/tasks/open$'),
    [URL_GOAL_DETAILS_TASKS_WORKFLOW]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/tasks/workflow$'
    ),
    [URL_GOAL_DETAILS_TASKS_DONE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/tasks/done$'),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    const projectUserGoals = async (pre = '', type = '') => {
        const projectDB = await admin.firestore().doc(`projects/${params.projectId}`).get()
        const project = projectDB.exists ? projectDB.data() : null

        const projectName = (project && project.name) || 'Project'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - ${pre} Goals`
        data.description = `Alldone.app. List of ${type} goals in the project ${projectName}`
    }

    const goalDetails = async (titleSuffix = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(admin.firestore().doc(`goals/${params.projectId}/items/${params.goalId}`).get())
        const groups = await Promise.all(promises)
        const project = groups[0].exists ? groups[0].data() : null
        const goal = groups[1].exists ? groups[1].data() : null

        const projectName = (project && project.name) || 'Project'
        const goalName =
            (goal && ParsingTextHelper.getObjectNameWithoutMeta(goal.extendedName || goal.name)) || 'Goal name...'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Goal details${titleSuffix}`
        data.description = `Alldone.app. Goal description: ${goalName}`
    }

    switch (urlConstant) {
        case URL_ALL_PROJECTS_GOALS: {
            data.title = `Alldone.app - All projects - Goals`
            data.description = 'Alldone.app. List of goals for all projects'
            break
        }
        case URL_ALL_PROJECTS_GOALS_OPEN: {
            data.title = `Alldone.app - All projects - Open Goals`
            data.description = 'Alldone.app. List of open goals for all projects'
            break
        }
        case URL_ALL_PROJECTS_GOALS_DONE: {
            data.title = `Alldone.app - All projects - Done Goals`
            data.description = 'Alldone.app. List of done goals for all projects'
            break
        }
        case URL_PROJECT_USER_GOALS_OPEN: {
            await projectUserGoals('Open', 'open')
            break
        }
        case URL_PROJECT_USER_GOALS_DONE: {
            await projectUserGoals('Done', 'done')
            break
        }
        case URL_GOAL_DETAILS: {
            await goalDetails()
            break
        }
        case URL_GOAL_DETAILS_FEED: {
            await goalDetails(' - Updates')
            break
        }
        case URL_GOAL_DETAILS_PROPERTIES: {
            await goalDetails(' - Properties')
            break
        }
        case URL_GOAL_DETAILS_CHAT: {
            await goalDetails(' - Chat')
            break
        }
        case URL_GOAL_DETAILS_BACKLINKS_TASKS: {
            await goalDetails(' - Linked tasks')
            break
        }
        case URL_GOAL_DETAILS_BACKLINKS_NOTES: {
            await goalDetails(' - Linked notes')
            break
        }
        case URL_GOAL_DETAILS_TASKS_OPEN: {
            await goalDetails(' - Tasks')
            break
        }
        case URL_GOAL_DETAILS_TASKS_WORKFLOW: {
            await goalDetails(' - Tasks')
            break
        }
        case URL_GOAL_DETAILS_TASKS_DONE: {
            await goalDetails(' - Tasks')
            break
        }
    }

    return data
}

module.exports = {
    URL_ALL_PROJECTS_GOALS,
    URL_ALL_PROJECTS_GOALS_OPEN,
    URL_ALL_PROJECTS_GOALS_DONE,
    URL_PROJECT_USER_GOALS,
    URL_PROJECT_USER_GOALS_OPEN,
    URL_PROJECT_USER_GOALS_DONE,
    URL_GOAL_DETAILS,
    URL_GOAL_DETAILS_PROPERTIES,
    URL_GOAL_DETAILS_CHAT,
    URL_GOAL_DETAILS_BACKLINKS_TASKS,
    URL_GOAL_DETAILS_BACKLINKS_NOTES,
    URL_GOAL_DETAILS_FEED,
    URL_GOAL_DETAILS_TASKS_OPEN,
    URL_GOAL_DETAILS_TASKS_WORKFLOW,
    URL_GOAL_DETAILS_TASKS_DONE,
    regexList,
    getMetadata,
}
