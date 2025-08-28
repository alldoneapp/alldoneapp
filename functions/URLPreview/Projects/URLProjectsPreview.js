const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /project/{projectId}
 */
const URL_PROJECT_DETAILS = 'PROJECT_DETAILS'

/**
 * /project/{projectId}/properties
 */
const URL_PROJECT_DETAILS_PROPERTIES = 'PROJECT_DETAILS_PROPERTIES'

/**
 * /project/{projectId}/members
 */
const URL_PROJECT_DETAILS_MEMBERS = 'PROJECT_DETAILS_MEMBERS'

/**
 * /project/{projectId}/assistants
 */
const URL_PROJECT_DETAILS_ASSISTANTS = 'PROJECT_DETAILS_ASSISTANTS'

/**
 * /project/{projectId}/backlinks/tasks
 */
const URL_PROJECT_DETAILS_BACKLINKS_TASKS = 'PROJECT_DETAILS_BACKLINKS_TASKS'

/**
 * /project/{projectId}/backlinks/notes
 */
const URL_PROJECT_DETAILS_BACKLINKS_NOTES = 'PROJECT_DETAILS_BACKLINKS_NOTES'

/**
 * /project/{projectId}/updates
 */
const URL_PROJECT_DETAILS_FEED = 'PROJECT_DETAILS_FEED'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_PROJECT_DETAILS]: new RegExp('^/project/(?<projectId>[\\w-]+)$'),
    [URL_PROJECT_DETAILS_PROPERTIES]: new RegExp('^/project/(?<projectId>[\\w-]+)/properties$'),
    [URL_PROJECT_DETAILS_MEMBERS]: new RegExp('^/project/(?<projectId>[\\w-]+)/members$'),
    [URL_PROJECT_DETAILS_BACKLINKS_TASKS]: new RegExp('^/project/(?<projectId>[\\w-]+)/backlinks/tasks$'),
    [URL_PROJECT_DETAILS_BACKLINKS_NOTES]: new RegExp('^/project/(?<projectId>[\\w-]+)/backlinks/notes$'),
    [URL_PROJECT_DETAILS_FEED]: new RegExp('^/project/(?<projectId>[\\w-]+)/updates$'),
    [URL_PROJECT_DETAILS_ASSISTANTS]: new RegExp('^/project/(?<projectId>[\\w-]+)/assistants$'),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }
    const projectDetails = async (titleSuffix = '') => {
        const projectData = await admin.firestore().doc(`projects/${params.projectId}`).get()
        const project = projectData.exists ? projectData.data() : null

        const projectName = (project && project.name) || 'Project'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Project details${titleSuffix}`
        data.description = `Alldone.app. ${projectName}`
    }

    switch (urlConstant) {
        case URL_PROJECT_DETAILS: {
            await projectDetails()
            break
        }
        case URL_PROJECT_DETAILS_PROPERTIES: {
            await projectDetails(' - Properties')
            break
        }
        case URL_PROJECT_DETAILS_MEMBERS: {
            await projectDetails(' - Members')
            break
        }
        case URL_PROJECT_DETAILS_ASSISTANTS: {
            await projectDetails(' - Assistants')
            break
        }
        case URL_PROJECT_DETAILS_BACKLINKS_TASKS: {
            await projectDetails(' - Linked tasks')
            break
        }
        case URL_PROJECT_DETAILS_BACKLINKS_NOTES: {
            await projectDetails(' - Linked notes')
            break
        }
        case URL_PROJECT_DETAILS_FEED: {
            await projectDetails(' - Updates')
            break
        }
    }

    return data
}

module.exports = {
    URL_PROJECT_DETAILS,
    URL_PROJECT_DETAILS_PROPERTIES,
    URL_PROJECT_DETAILS_MEMBERS,
    URL_PROJECT_DETAILS_BACKLINKS_TASKS,
    URL_PROJECT_DETAILS_BACKLINKS_NOTES,
    URL_PROJECT_DETAILS_FEED,
    URL_PROJECT_DETAILS_ASSISTANTS,
    regexList,
    getMetadata,
}
