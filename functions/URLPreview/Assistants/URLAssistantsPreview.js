const { GLOBAL_PROJECT_ID } = require('../../Firestore/assistantsFirestore')
const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /projects/{projectId}/assistants/{assistantId}
 */
const URL_ASSISTANT_DETAILS = 'ASSISTANT_DETAILS'

/**
 * /projects/{projectId}/assistants/{assistantId}/customizations
 */
const URL_ASSISTANT_DETAILS_CUSTOMIZATIONS = 'ASSISTANT_DETAILS_CUSTOMIZATIONS'

/**
 * /projects/{projectId}/assistants/{assistantId}/backlinks/tasks
 */
const URL_ASSISTANT_DETAILS_BACKLINKS_TASKS = 'ASSISTANT_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/assistants/{assistantId}/backlinks/notes
 */
const URL_ASSISTANT_DETAILS_BACKLINKS_NOTES = 'ASSISTANT_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/assistants/{assistantId}/note
 */
const URL_ASSISTANT_DETAILS_NOTE = 'ASSISTANT_DETAILS_NOTE'

/**
 * /projects/{projectId}/assistants/{assistantId}/chat
 */
const URL_ASSISTANT_DETAILS_CHAT = 'ASSISTANT_DETAILS_CHAT'

/**
 * /projects/{projectId}/assistants/{assistantId}/updates
 */
const URL_ASSISTANT_DETAILS_UPDATES = 'ASSISTANT_DETAILS_UPDATES'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_ASSISTANT_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)$'),
    [URL_ASSISTANT_DETAILS_CUSTOMIZATIONS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/customizations$'
    ),
    [URL_ASSISTANT_DETAILS_BACKLINKS_TASKS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/backlinks/tasks$'
    ),
    [URL_ASSISTANT_DETAILS_BACKLINKS_NOTES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/backlinks/notes$'
    ),
    [URL_ASSISTANT_DETAILS_NOTE]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/note$'
    ),
    [URL_ASSISTANT_DETAILS_CHAT]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/chat$'
    ),
    [URL_ASSISTANT_DETAILS_UPDATES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/updates$'
    ),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    const assistantDetails = async (titleSuffix = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(admin.firestore().doc(`assistants/${params.projectId}/items/${params.assistantId}`).get())
        promises.push(admin.firestore().doc(`assistants/${GLOBAL_PROJECT_ID}/items/${params.assistantId}`).get())
        const groups = await Promise.all(promises)
        const project = groups[0].exists ? groups[0].data() : null
        const assistant = groups[1].exists ? groups[1].data() : null
        const globalAssistant = groups[2].exists ? groups[2].data() : null

        const projectName = (project && project.name) || 'Project'
        const assistantName =
            (assistant && assistant.displayName) ||
            (globalAssistant && globalAssistant.displayName) ||
            'Assistant name...'

        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Assistant details${titleSuffix}`
        data.description = `Alldone.app. Assistant description: ${assistantName}`
    }

    switch (urlConstant) {
        case URL_ASSISTANT_DETAILS: {
            await assistantDetails()
            break
        }
        case URL_ASSISTANT_DETAILS_CUSTOMIZATIONS: {
            await assistantDetails(' - Customizations')
            break
        }
        case URL_ASSISTANT_DETAILS_BACKLINKS_TASKS: {
            await assistantDetails(' - Linked tasks')
            break
        }
        case URL_ASSISTANT_DETAILS_BACKLINKS_NOTES: {
            await assistantDetails(' - Linked notes')
            break
        }
        case URL_ASSISTANT_DETAILS_NOTE: {
            await assistantDetails(' - Note')
            break
        }
        case URL_ASSISTANT_DETAILS_CHAT: {
            await assistantDetails(' - Chat')
            break
        }
        case URL_ASSISTANT_DETAILS_UPDATES: {
            await assistantDetails(' - Updates')
            break
        }
    }

    return data
}

module.exports = {
    URL_ASSISTANT_DETAILS,
    URL_ASSISTANT_DETAILS_CUSTOMIZATIONS,
    URL_ASSISTANT_DETAILS_BACKLINKS_TASKS,
    URL_ASSISTANT_DETAILS_BACKLINKS_NOTES,
    URL_ASSISTANT_DETAILS_NOTE,
    URL_ASSISTANT_DETAILS_CHAT,
    URL_ASSISTANT_DETAILS_UPDATES,
    regexList,
    getMetadata,
}
