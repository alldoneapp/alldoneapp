import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /projects/notes/followed
 */
export const URL_ALL_PROJECTS_NOTES_FOLLOWED = 'ALL_PROJECTS_NOTES_FOLLOWED'

/**
 * /projects/notes/all
 */
export const URL_ALL_PROJECTS_NOTES_ALL = 'ALL_PROJECTS_NOTES_ALL'

/**
 * /projects/{projectId}/user/{userId}/notes/followed
 */
export const URL_PROJECT_USER_NOTES_FOLLOWED = 'PROJECT_NOTES_FOLLOWED'

/**
 * /projects/{projectId}/user/{userId}/notes/all
 */
export const URL_PROJECT_USER_NOTES_ALL = 'PROJECT_NOTES_ALL'

/**
 * /projects/{projectId}/notes/{noteId}
 */
export const URL_NOTE_DETAILS = 'NOTE_DETAILS'

/**
 * /projects/{projectId}/notes/{noteId}/properties
 */
export const URL_NOTE_DETAILS_PROPERTIES = 'NOTE_DETAILS_PROPERTIES'

/**
 * /projects/{projectId}/notes/{noteId}/chat
 */
export const URL_NOTE_DETAILS_CHAT = 'NOTE_DETAILS_CHAT'

/**
 * /projects/{projectId}/notes/{noteId}/backlinks/tasks
 */
export const URL_NOTE_DETAILS_BACKLINKS_TASKS = 'NOTE_DETAILS_BACKLINKS_TASKS'

/**
 * /projects/{projectId}/notes/{noteId}/backlinks/notes
 */
export const URL_NOTE_DETAILS_BACKLINKS_NOTES = 'NOTE_DETAILS_BACKLINKS_NOTES'

/**
 * /projects/{projectId}/notes/{noteId}/editor
 */
export const URL_NOTE_DETAILS_EDITOR = 'NOTE_DETAILS_EDITOR'

/**
 * /projects/{projectId}/notes/{noteId}/updates
 */
export const URL_NOTE_DETAILS_FEED = 'NOTE_DETAILS_FEED'

export const MAX_CHARACTERS_NOTE_DOC_TITLE = 100

/**
 * URL System for Notes
 */
class URLsNotes {
    /**
     * Replace the history url
     * @param urlConstant
     * @param data
     * @param params
     */
    static replace = (urlConstant, data = null, ...params) => {
        const originPath = window.location.origin
        let urlPath = URLsNotes.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath, true)

        URLsNotes.setTitle(urlConstant, false, ...params)
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
        let urlPath = URLsNotes.getPath(urlConstant, ...params)

        URLSystem.setLastNavigationScreen(urlPath)

        URLsNotes.setTitle(urlConstant, false, ...params)
        history.pushState(data, '', `${originPath}/${urlPath}`)
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ALL_PROJECTS_NOTES_FOLLOWED:
                return `projects/notes/followed`
            case URL_ALL_PROJECTS_NOTES_ALL:
                return `projects/notes/all`
            case URL_PROJECT_USER_NOTES_FOLLOWED:
                return `projects/${params[0]}/user/${params[1]}/notes/followed`
            case URL_PROJECT_USER_NOTES_ALL:
                return `projects/${params[0]}/user/${params[1]}/notes/all`
            case URL_NOTE_DETAILS:
                return `projects/${params[0]}/notes/${params[1]}`
            case URL_NOTE_DETAILS_FEED:
                return `projects/${params[0]}/notes/${params[1]}/updates`
            case URL_NOTE_DETAILS_PROPERTIES:
                return `projects/${params[0]}/notes/${params[1]}/properties`
            case URL_NOTE_DETAILS_CHAT:
                return `projects/${params[0]}/notes/${params[1]}/chat`
            case URL_NOTE_DETAILS_BACKLINKS_TASKS:
                return `projects/${params[0]}/notes/${params[1]}/backlinks/tasks`
            case URL_NOTE_DETAILS_BACKLINKS_NOTES:
                return `projects/${params[0]}/notes/${params[1]}/backlinks/notes`
            case URL_NOTE_DETAILS_EDITOR:
                return `projects/${params[0]}/notes/${params[1]}/editor`
        }
    }

    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title = ''

        const projectUserNotes = (pre = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            title = `${prefix}${shrinkTagText(projectName)} - ${pre} Notes`
        }

        const noteDetails = (titleSuffix = '') => {
            const projectName = ProjectHelper.getProjectNameById(params[0], 'Project')
            let noteTitle = shrinkTagText(params[params.length - 1], MAX_CHARACTERS_NOTE_DOC_TITLE)
            noteTitle = noteTitle != null && noteTitle !== '' ? noteTitle : 'Note details'
            title = `${prefix}${shrinkTagText(projectName)} - ${noteTitle}${titleSuffix}`
        }

        switch (urlConstant) {
            case URL_ALL_PROJECTS_NOTES_FOLLOWED: {
                title = `${prefix}All projects - Followed Notes`
                break
            }
            case URL_ALL_PROJECTS_NOTES_ALL: {
                title = `${prefix}All projects - All Notes`
                break
            }
            case URL_PROJECT_USER_NOTES_FOLLOWED: {
                projectUserNotes('Followed')
                break
            }
            case URL_PROJECT_USER_NOTES_ALL: {
                projectUserNotes('All')
                break
            }
            case URL_NOTE_DETAILS: {
                noteDetails()
                break
            }
            case URL_NOTE_DETAILS_FEED: {
                noteDetails(' - Updates')
                break
            }
            case URL_NOTE_DETAILS_PROPERTIES: {
                noteDetails(' - Properties')
                break
            }
            case URL_NOTE_DETAILS_CHAT: {
                noteDetails(' - Chat')
                break
            }
            case URL_NOTE_DETAILS_BACKLINKS_TASKS: {
                noteDetails(' - Linked tasks')
                break
            }
            case URL_NOTE_DETAILS_BACKLINKS_NOTES: {
                noteDetails(' - Linked notes')
                break
            }
            case URL_NOTE_DETAILS_EDITOR: {
                noteDetails(' - Editor')
                break
            }
        }

        !internal && (document.title = title)
        return title
    }
}

export default URLsNotes
