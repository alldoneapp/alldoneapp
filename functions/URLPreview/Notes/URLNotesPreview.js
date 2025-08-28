const ParsingTextHelper = require('../../ParsingTextHelper')
const { shrinkTagText } = require('../../Utils/parseTextUtils')

/**
 * /projects/notes/followed
 */
const URL_ALL_PROJECTS_NOTES_FOLLOWED = 'ALL_PROJECTS_NOTES_FOLLOWED'

/**
 * /projects/notes/all
 */
const URL_ALL_PROJECTS_NOTES_ALL = 'ALL_PROJECTS_NOTES_ALL'

/**
 * /projects/{projectId}/user/{userId}/notes/followed
 */
const URL_PROJECT_USER_NOTES_FOLLOWED = 'PROJECT_NOTES_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/notes/all
 */
const URL_PROJECT_USER_NOTES_ALL = 'PROJECT_NOTES_ALL'

/**
 * /projects/{projectId}/notes/{noteId}
 */
const URL_NOTE_DETAILS = 'NOTE_DETAILS'

/**
 * /projects/{projectId}/notes/{noteId}/properties
 */
const URL_NOTE_DETAILS_PROPERTIES = 'NOTE_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/notes/{noteId}/chat
 */
const URL_NOTE_DETAILS_CHAT = 'NOTE_DETAILS_CHAT'

/**
 * /projects/{projectId}/notes/{noteId}/backlinks/tasks
 */
const URL_NOTE_DETAILS_BACKLINKS_TASKS = 'NOTE_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/notes/{noteId}/backlinks/notes
 */
const URL_NOTE_DETAILS_BACKLINKS_NOTES = 'NOTE_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/notes/{noteId}/editor
 */
const URL_NOTE_DETAILS_EDITOR = 'NOTE_DETAILS_EDITOR'

/**
 * /projects/{projectId}/notes/{noteId}/updates
 */
const URL_NOTE_DETAILS_FEED = 'NOTE_DETAILS_FEED'

/////////////////////////   REGEXP   /////////////////////////

const regexList = {
    [URL_ALL_PROJECTS_NOTES_FOLLOWED]: new RegExp('^/projects/notes/followed$'),
    [URL_ALL_PROJECTS_NOTES_ALL]: new RegExp('^/projects/notes/all$'),
    [URL_PROJECT_USER_NOTES_FOLLOWED]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/notes/followed$'
    ),
    [URL_PROJECT_USER_NOTES_ALL]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/notes/all$'),
    [URL_NOTE_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)$'),
    [URL_NOTE_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/updates$'),
    [URL_NOTE_DETAILS_PROPERTIES]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/properties$'),
    [URL_NOTE_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/chat$'),
    [URL_NOTE_DETAILS_BACKLINKS_TASKS]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/backlinks/tasks$'
    ),
    [URL_NOTE_DETAILS_BACKLINKS_NOTES]: new RegExp(
        '^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/backlinks/notes$'
    ),
    [URL_NOTE_DETAILS_EDITOR]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/editor$'),
}

/////////////////////////   FUNCTIONS   /////////////////////////

const getMetadata = async (admin, urlConstant, params) => {
    const data = { title: '', description: '' }

    const projectUserNotes = async (pre = '', type = '') => {
        const projectDB = await admin.firestore().doc(`projects/${params.projectId}`).get()
        const project = projectDB.exists ? projectDB.data() : null

        const projectName = (project && project.name) || 'Project'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Tasks`
        data.description = `Alldone.app. List of ${type} notes in the project ${projectName}`
    }

    const noteDetails = async (titleSuffix = '') => {
        const promises = []
        promises.push(admin.firestore().doc(`projects/${params.projectId}`).get())
        promises.push(admin.firestore().doc(`noteItems/${params.projectId}/notes/${params.noteId}`).get())
        const groups = await Promise.all(promises)
        const project = groups[0].exists ? groups[0].data() : null
        const note = groups[1].exists ? groups[1].data() : null

        const projectName = (project && project.name) || 'Project'
        const noteTitle =
            (note && ParsingTextHelper.getObjectNameWithoutMeta(note.extendedTitle || note.title)) || 'Note title...'
        const notePreview = (note && note.preview) || 'Note preview...'
        data.title = `Alldone.app - ${shrinkTagText(projectName)} - Note${titleSuffix} - ${noteTitle}`
        data.description = `Alldone.app. Note preview: ${notePreview}`
    }

    switch (urlConstant) {
        case URL_ALL_PROJECTS_NOTES_FOLLOWED: {
            data.title = `Alldone.app - All projects - Followed Notes`
            data.description = 'Alldone.app. List of followed notes for all projects'
            break
        }
        case URL_ALL_PROJECTS_NOTES_ALL: {
            data.title = `Alldone.app - All projects - All Notes`
            data.description = 'Alldone.app. List of all notes for all projects'
            break
        }
        case URL_PROJECT_USER_NOTES_FOLLOWED: {
            await projectUserNotes('Followed', 'followed')
            break
        }
        case URL_PROJECT_USER_NOTES_ALL: {
            await projectUserNotes('All', 'all')
            break
        }
        case URL_NOTE_DETAILS: {
            await noteDetails()
            break
        }
        case URL_NOTE_DETAILS_FEED: {
            await noteDetails(' - Updates')
            break
        }
        case URL_NOTE_DETAILS_PROPERTIES: {
            await noteDetails(' - Properties')
            break
        }
        case URL_NOTE_DETAILS_CHAT: {
            await noteDetails(' - Chat')
            break
        }
        case URL_NOTE_DETAILS_BACKLINKS_TASKS: {
            await noteDetails(' - Linked tasks')
            break
        }
        case URL_NOTE_DETAILS_BACKLINKS_NOTES: {
            await noteDetails(' - Linked notes')
            break
        }
        case URL_NOTE_DETAILS_EDITOR: {
            await noteDetails(' - Editor')
            break
        }
    }

    return data
}

module.exports = {
    URL_ALL_PROJECTS_NOTES_FOLLOWED,
    URL_ALL_PROJECTS_NOTES_ALL,
    URL_PROJECT_USER_NOTES_FOLLOWED,
    URL_PROJECT_USER_NOTES_ALL,
    URL_NOTE_DETAILS,
    URL_NOTE_DETAILS_PROPERTIES,
    URL_NOTE_DETAILS_CHAT,
    URL_NOTE_DETAILS_BACKLINKS_TASKS,
    URL_NOTE_DETAILS_BACKLINKS_NOTES,
    URL_NOTE_DETAILS_EDITOR,
    URL_NOTE_DETAILS_FEED,
    regexList,
    getMetadata,
}
