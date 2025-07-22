const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /projects/chats/followed
 */
const URL_ALL_PROJECTS_CHATS_FOLLOWED = 'ALL_PROJECTS_CHATS_FOLLOWED'

/**
 * /projects/chats/all
 */
const URL_ALL_PROJECTS_CHATS_ALL = 'ALL_PROJECTS_CHATS_ALL'

/**
 * /projects/{projectId}/user/{userId}/chats/followed
 */
const URL_PROJECT_USER_CHATS_FOLLOWED = 'PROJECT_CHATS_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/chats/all
 */
const URL_PROJECT_USER_CHATS_ALL = 'PROJECT_CHATS_ALL'

/**
 * /projects/{projectId}/chats/{chatId}/chat
 */
const URL_CHAT_DETAILS = 'CHAT_DETAILS'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_ALL_PROJECTS_CHATS_FOLLOWED]: new RegExp('^/projects/chats/followed$'),
    [URL_ALL_PROJECTS_CHATS_ALL]: new RegExp('^/projects/chats/all$'),
    [URL_PROJECT_USER_CHATS_FOLLOWED]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/chats/followed$'
    ),
    [URL_PROJECT_USER_CHATS_ALL]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/chats/all$'),
    [URL_CHAT_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/chats/(?<chatId>[\\w-]+)/chat$'),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    const projectUserChats = async (pre = '', type = '') => {
        const projectDB = await admin.firestore().doc(`projects/${params.projectId}`).get()
        const project = projectDB.exists ? projectDB.data() : null

        const projectName = (project && project.name) || 'Project'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - ${pre} Chats`
        data.description = `Alldone.app. List of ${type} chats in the project ${projectName}`
    }

    const chatDetails = async (titleSuffix = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(admin.firestore().doc(`chatObjects/${params.projectId}/chats/${params.chatId}`).get())
        const groups = await Promise.all(promises)
        const project = groups[0].exists ? groups[0].data() : null
        const chat = groups[1].exists ? groups[1].data() : null

        const projectName = (project && project.name) || 'Project'
        const chatTitle = (chat && chat.title) || 'Chat title...'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Chat details${titleSuffix}`
        data.description = `Alldone.app. Chat description: ${chatTitle}`
    }

    switch (urlConstant) {
        case URL_ALL_PROJECTS_CHATS_FOLLOWED: {
            data.title = `Alldone.app - All projects - Followed Chats`
            data.description = 'Alldone.app. List of followed chats for all projects'
            break
        }
        case URL_ALL_PROJECTS_CHATS_ALL: {
            data.title = `Alldone.app - All projects - All Chats`
            data.description = 'Alldone.app. List of all chats for all projects'
            break
        }
        case URL_PROJECT_USER_CHATS_FOLLOWED: {
            await projectUserChats('Followed', 'followed')
            break
        }
        case URL_PROJECT_USER_CHATS_ALL: {
            await projectUserChats('All', 'all')
            break
        }
        case URL_CHAT_DETAILS: {
            await chatDetails()
            break
        }
    }

    return data
}

module.exports = {
    URL_ALL_PROJECTS_CHATS_FOLLOWED,
    URL_ALL_PROJECTS_CHATS_ALL,
    URL_PROJECT_USER_CHATS_FOLLOWED,
    URL_PROJECT_USER_CHATS_ALL,
    URL_CHAT_DETAILS,
    regexList,
    getMetadata,
}
