const { getContactData } = require('../../Firestore/contactsFirestore')
const { getUserData } = require('../../Users/usersFirestore')
const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /projects/contacts/all
 */
const URL_ALL_PROJECTS_PEOPLE_ALL = 'ALL_PROJECTS_PEOPLE_ALL'

/**
 * /projects/contacts/followed
 */
const URL_ALL_PROJECTS_PEOPLE_FOLLOWED = 'ALL_PROJECTS_PEOPLE_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/contacts/all
 */
const URL_PROJECT_PEOPLE_ALL = 'PROJECT_PEOPLE_ALL'

/**
 * /projects/{projectId}/user/{userId}/contacts/followed
 */
const URL_PROJECT_PEOPLE_FOLLOWED = 'PROJECT_PEOPLE_FOLLOWED'

/**
 * /projects/{projectId}/contacts/{userId}
 */
const URL_PEOPLE_DETAILS = 'PEOPLE_DETAILS'

/**
 * /projects/{projectId}/contacts/{userId}/updates
 */
const URL_PEOPLE_DETAILS_FEED = 'PEOPLE_DETAILS_FEED'

/**
 * /projects/{projectId}/contacts/{userId}/workflow
 */
const URL_PEOPLE_DETAILS_WORKFLOW = 'PEOPLE_DETAILS_WORKFLOW'

/**
 * /projects/{projectId}/contacts/{userId}/properties
 */
const URL_PEOPLE_DETAILS_PROPERTIES = 'PEOPLE_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/contacts/{userId}/profile
 */
const URL_PEOPLE_DETAILS_PROFILE = 'PEOPLE_DETAILS_PROFILE'

/**
 * /projects/{projectId}/contacts/{userId}/chat
 */
const URL_PEOPLE_DETAILS_CHAT = 'PEOPLE_DETAILS_CHAT'

/**
 * /projects/{projectId}/contacts/{userId}/statistics
 */
const URL_PEOPLE_DETAILS_STATISTICS = 'PEOPLE_DETAILS_STATISTICS'

/**
 * /projects/{projectId}/contacts/{userId}/backlinks/tasks
 */
const URL_PEOPLE_DETAILS_BACKLINKS_TASKS = 'PEOPLE_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/contacts/{userId}/backlinks/notes
 */
const URL_PEOPLE_DETAILS_BACKLINKS_NOTES = 'PEOPLE_DETAILS_BACKLINKS_NOTES'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_ALL_PROJECTS_PEOPLE_ALL]: new RegExp('^/projects/contacts/all$'),
    [URL_ALL_PROJECTS_PEOPLE_FOLLOWED]: new RegExp('^/projects/contacts/followed$'),
    [URL_PROJECT_PEOPLE_ALL]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/contacts/all$'),
    [URL_PROJECT_PEOPLE_FOLLOWED]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/contacts/followed$'
    ),
    [URL_PEOPLE_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)$'),
    [URL_PEOPLE_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/updates$'),
    [URL_PEOPLE_DETAILS_WORKFLOW]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/workflow$'),
    [URL_PEOPLE_DETAILS_PROPERTIES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/properties$'
    ),
    [URL_PEOPLE_DETAILS_PROFILE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/profile$'),
    [URL_PEOPLE_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/chat$'),
    [URL_PEOPLE_DETAILS_STATISTICS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/statistics$'
    ),
    [URL_PEOPLE_DETAILS_BACKLINKS_TASKS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/backlinks/tasks$'
    ),
    [URL_PEOPLE_DETAILS_BACKLINKS_NOTES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/backlinks/notes$'
    ),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    const projectUserTasks = async (pre = '', type = '') => {
        const projectData = await admin.firestore().doc(`projects/${params.projectId}`).get()
        const project = projectData.exists ? projectData.data() : null

        const projectName = (project && project.name) || 'Project'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - ${pre} Contacts`
        data.description = `Alldone.app. List of ${type} contacts in the project ${projectName}`
    }

    const contactDetails = async (titleSuffix = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(getUserData(params.userId))
        promises.push(getContactData(admin.firestore(), params.projectId, params.userId))
        const [projectDoc, user, contact] = await Promise.all(promises)

        const project = projectDoc.data()
        const finalUser = contact || user

        const projectName = (project && project.name) || 'Project'
        const contactName = (finalUser && finalUser.displayName) || 'Contact name...'
        const contactCompany = (finalUser && finalUser.company) || ''
        const contactRole = (finalUser && finalUser.role) || ''
        const contactDescription = (finalUser && finalUser.description) || ''
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Contact details${titleSuffix}`
        data.description = `Alldone.app. Contact description: ${contactName} | ${contactCompany} | ${contactRole} | ${contactDescription}`
    }

    switch (urlConstant) {
        case URL_ALL_PROJECTS_PEOPLE_ALL: {
            data.title = `Alldone.app - All projects - All Contacts`
            data.description = `Alldone.app. List of all contacts for all projects`
            break
        }
        case URL_ALL_PROJECTS_PEOPLE_FOLLOWED: {
            data.title = `Alldone.app - All projects - Followed Contacts`
            data.description = `Alldone.app. List of followed contacts for all projects`
            break
        }
        case URL_PROJECT_PEOPLE_ALL: {
            await projectUserTasks('All', 'all')
            break
        }
        case URL_PROJECT_PEOPLE_FOLLOWED: {
            await projectUserTasks('Followed', 'followed')
            break
        }
        case URL_PEOPLE_DETAILS: {
            await contactDetails()
            break
        }
        case URL_PEOPLE_DETAILS_FEED: {
            await contactDetails(' - Updates')
            break
        }
        case URL_PEOPLE_DETAILS_WORKFLOW: {
            await contactDetails(' - Workflow')
            break
        }
        case URL_PEOPLE_DETAILS_PROPERTIES: {
            await contactDetails(' - Properties')
            break
        }
        case URL_PEOPLE_DETAILS_PROFILE: {
            await contactDetails(' - Profile')
            break
        }
        case URL_PEOPLE_DETAILS_CHAT: {
            await contactDetails(' - Chat')
            break
        }
        case URL_PEOPLE_DETAILS_STATISTICS: {
            await contactDetails(' - Statistics')
            break
        }
        case URL_PEOPLE_DETAILS_BACKLINKS_TASKS: {
            await contactDetails(' - Linked tasks')
            break
        }
        case URL_PEOPLE_DETAILS_BACKLINKS_NOTES: {
            await contactDetails(' - Linked notes')
            break
        }
    }

    return data
}

module.exports = {
    URL_ALL_PROJECTS_PEOPLE_ALL,
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PROJECT_PEOPLE_ALL,
    URL_PROJECT_PEOPLE_FOLLOWED,
    URL_PEOPLE_DETAILS,
    URL_PEOPLE_DETAILS_FEED,
    URL_PEOPLE_DETAILS_WORKFLOW,
    URL_PEOPLE_DETAILS_PROPERTIES,
    URL_PEOPLE_DETAILS_PROFILE,
    URL_PEOPLE_DETAILS_CHAT,
    URL_PEOPLE_DETAILS_STATISTICS,
    URL_PEOPLE_DETAILS_BACKLINKS_TASKS,
    URL_PEOPLE_DETAILS_BACKLINKS_NOTES,
    regexList,
    getMetadata,
}
