import store from '../../redux/store'
import { hideFloatPopup, hideGlobalSearchPopup, setGlobalSearchResults } from '../../redux/actions'
import URLTrigger from '../../URLSystem/URLTrigger'
import NavigationService from '../../utils/NavigationService'
import { checkDVLink, getDvNoteTabLink } from '../../utils/LinkingHelper'
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

export const goToObjectDetailView = (projectId, objectId, objectType, detailedViewType) => {
    store.dispatch([hideFloatPopup(), setGlobalSearchResults(null), hideGlobalSearchPopup()])
    const tabView = objectType === 'chats' ? 'chat' : objectType === 'notes' ? 'editor' : 'properties'
    checkDVLink(detailedViewType)
    let linkUrl = `/projects/${projectId}/${objectType}/${objectId}/${tabView}`
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
    let dvType = ''

    if (type === 'tasks') {
        dvType = 'task'
    } else if (type === 'goals') {
        dvType = 'goal'
    } else if (type === 'users' || type === 'contacts') {
        dvType = 'people'
    } else if (type === 'topics') {
        dvType = 'chat'
    } else if (type === 'skills') {
        dvType = 'skills'
    } else if (type === 'assistants') {
        dvType = 'assistants'
    }

    store.dispatch([hideFloatPopup(), setGlobalSearchResults(null), hideGlobalSearchPopup()])
    checkDVLink(dvType)
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
