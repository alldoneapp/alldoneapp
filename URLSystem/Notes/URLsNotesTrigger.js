import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_ALL_PROJECTS_NOTES_ALL,
    URL_ALL_PROJECTS_NOTES_FOLLOWED,
    URL_NOTE_DETAILS,
    URL_NOTE_DETAILS_BACKLINKS_NOTES,
    URL_NOTE_DETAILS_BACKLINKS_TASKS,
    URL_NOTE_DETAILS_EDITOR,
    URL_NOTE_DETAILS_PROPERTIES,
    URL_PROJECT_USER_NOTES_ALL,
    URL_PROJECT_USER_NOTES_FOLLOWED,
    URL_NOTE_DETAILS_FEED,
    URL_NOTE_DETAILS_CHAT,
} from './URLsNotes'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
import { ALL_TAB, FOLLOWED_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import {
    DV_TAB_NOTE_BACKLINKS,
    DV_TAB_NOTE_EDITOR,
    DV_TAB_NOTE_PROPERTIES,
    DV_TAB_NOTE_UPDATES,
    DV_TAB_NOTE_CHAT,
} from '../../utils/TabNavigationConstants'
import store from '../../redux/store'
import SharedHelper from '../../utils/SharedHelper'

class URLsNotesTrigger {
    static getRegexList = () => {
        return {
            [URL_ALL_PROJECTS_NOTES_FOLLOWED]: new RegExp('^/projects/notes/followed$'),
            [URL_ALL_PROJECTS_NOTES_ALL]: new RegExp('^/projects/notes/all$'),
            [URL_PROJECT_USER_NOTES_FOLLOWED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/notes/followed$'
            ),
            [URL_PROJECT_USER_NOTES_ALL]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/notes/all$'
            ),
            [URL_NOTE_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)$'),
            [URL_NOTE_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/updates$'),
            [URL_NOTE_DETAILS_PROPERTIES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/properties$'
            ),
            [URL_NOTE_DETAILS_BACKLINKS_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/backlinks/tasks$'
            ),
            [URL_NOTE_DETAILS_BACKLINKS_NOTES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/backlinks/notes$'
            ),
            [URL_NOTE_DETAILS_EDITOR]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/editor$'),
            [URL_NOTE_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/notes/(?<noteId>[\\w-]+)/chat$'),
        }
    }

    static match = pathname => {
        const regexList = URLsNotesTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsNotesTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // Extract query parameters
        const urlParams = new URLSearchParams(window.location.search)
        const autoStartTranscription = urlParams.get('autoStartTranscription') === 'true'
        console.log('[URLsNotesTrigger] trigger called, pathname:', pathname)
        console.log('[URLsNotesTrigger] matchedObj.key:', matchedObj.key)
        console.log('[URLsNotesTrigger] autoStartTranscription:', autoStartTranscription)

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_ALL_PROJECTS_NOTES_FOLLOWED:
                return TasksHelper.processURLAllProjectsNotes(navigation, FOLLOWED_TAB)
            case URL_ALL_PROJECTS_NOTES_ALL:
                return TasksHelper.processURLAllProjectsNotes(navigation, ALL_TAB)
            case URL_PROJECT_USER_NOTES_FOLLOWED:
                return TasksHelper.processURLProjectsUserNotes(
                    navigation,
                    params.projectId,
                    params.userId,
                    FOLLOWED_TAB
                )
            case URL_PROJECT_USER_NOTES_ALL:
                return TasksHelper.processURLProjectsUserNotes(navigation, params.projectId, params.userId, ALL_TAB)
            case URL_NOTE_DETAILS:
                return TasksHelper.processURLNoteDetails(navigation, params.projectId, params.noteId)
            case URL_NOTE_DETAILS_FEED:
                return TasksHelper.processURLNoteDetailsTab(
                    navigation,
                    DV_TAB_NOTE_UPDATES,
                    params.projectId,
                    params.noteId
                )
            case URL_NOTE_DETAILS_PROPERTIES:
                return TasksHelper.processURLNoteDetailsTab(
                    navigation,
                    DV_TAB_NOTE_PROPERTIES,
                    params.projectId,
                    params.noteId
                )
            case URL_NOTE_DETAILS_CHAT:
                return TasksHelper.processURLNoteDetailsTab(
                    navigation,
                    DV_TAB_NOTE_CHAT,
                    params.projectId,
                    params.noteId
                )
            case URL_NOTE_DETAILS_BACKLINKS_TASKS:
                return TasksHelper.processURLNoteDetailsTab(
                    navigation,
                    DV_TAB_NOTE_BACKLINKS,
                    params.projectId,
                    params.noteId,
                    URL_NOTE_DETAILS_BACKLINKS_TASKS
                )
            case URL_NOTE_DETAILS_BACKLINKS_NOTES:
                return TasksHelper.processURLNoteDetailsTab(
                    navigation,
                    DV_TAB_NOTE_BACKLINKS,
                    params.projectId,
                    params.noteId,
                    URL_NOTE_DETAILS_BACKLINKS_NOTES
                )
            case URL_NOTE_DETAILS_EDITOR:
                return TasksHelper.processURLNoteDetailsTab(
                    navigation,
                    DV_TAB_NOTE_EDITOR,
                    params.projectId,
                    params.noteId,
                    null,
                    autoStartTranscription
                )
        }
    }
}

export default URLsNotesTrigger
