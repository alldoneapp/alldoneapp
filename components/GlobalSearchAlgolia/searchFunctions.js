import store from '../../redux/store'
import { hideFloatPopup, hideGlobalSearchPopup, setGlobalSearchResults } from '../../redux/actions'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import { getDvNoteTabLink } from '../../utils/LinkingHelper'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from '../Feeds/CommentsTextInput/textInputHelper'
import {
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_UPDATES,
} from '../../utils/TabNavigationConstants'

export const getWikiPagePath = (projectId, slug) => `/projects/${projectId}/wiki/${slug}`

const getSearchResultPath = (projectId, objectId, objectType, tabView) => {
    if (objectType === 'artifacts') return `/projects/${projectId}/artifacts/${objectId}`
    if (objectType === 'wiki') return getWikiPagePath(projectId, objectId)
    return `/projects/${projectId}/${objectType}/${objectId}/${tabView}`
}

export const goToObjectDetailView = (projectId, objectId, objectType, detailedViewType) => {
    store.dispatch([hideFloatPopup(), setGlobalSearchResults(null), hideGlobalSearchPopup()])
    const tabView = objectType === 'chats' ? 'chat' : objectType === 'notes' ? 'editor' : 'properties'
    // An artifact opens in place in the Artifacts tab, which has no properties sub-route; a wiki
    // page opens in the project's wiki.
    let linkUrl = getSearchResultPath(projectId, objectId, objectType, tabView)
    URLTrigger.directProcessUrl(NavigationService, linkUrl)
}

export const convertNoteObjectType = parentObjectType => {
    if (parentObjectType === 'tasks') {
        return 'tasks'
    } else if (parentObjectType === 'goals') {
        return 'goals'
    } else if (parentObjectType === 'users' || parentObjectType === 'contacts') {
        return 'contacts'
    } else if (parentObjectType === 'topics') {
        return 'chats'
    } else if (parentObjectType === 'skills') {
        return 'skills'
    }
}

export const goToObjectNoteView = (projectId, parentObject) => {
    const { type, id } = parentObject
    const url = getDvNoteTabLink(projectId, id, type === 'topics' ? 'chats' : type)

    store.dispatch([hideFloatPopup(), setGlobalSearchResults(null), hideGlobalSearchPopup()])
    URLTrigger.directProcessUrl(NavigationService, url)
}

export const getInitialTab = () => {
    const { route } = store.getState()
    switch (route) {
        case DV_TAB_ROOT_TASKS:
        case 'TaskDetailedView':
            return MENTION_MODAL_TASKS_TAB
        case DV_TAB_ROOT_GOALS:
        case 'GoalDetailedView':
            return MENTION_MODAL_GOALS_TAB
        case DV_TAB_ROOT_NOTES:
        case 'NotesDetailedView':
            return MENTION_MODAL_NOTES_TAB
        case DV_TAB_ROOT_CONTACTS:
        case 'ContactDetailedView':
        case 'UserDetailedView':
        case 'AssistantDetailedView':
            return MENTION_MODAL_CONTACTS_TAB
        case DV_TAB_ROOT_UPDATES:
        case 'ChatDetailedView':
            return MENTION_MODAL_TOPICS_TAB
        default:
            return MENTION_MODAL_TASKS_TAB
    }
}
