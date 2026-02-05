import v4 from 'uuid/v4'
import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import { REGEX_URL } from '../components/Feeds/Utils/HelperFunctions'
import { setSelectedSidebarTab } from '../redux/actions'
import { DV_TAB_ROOT_CONTACTS, DV_TAB_ROOT_NOTES, DV_TAB_ROOT_TASKS, DV_TAB_ROOT_GOALS } from './TabNavigationConstants'
import store from '../redux/store'
import NavigationService from '../utils/NavigationService'
import { getAppUrlHost } from './backends/firestore'

export const LINKED_OBJECT_TYPE_CONTACT = 'contact'
export const LINKED_OBJECT_TYPE_PROJECT = 'project'
export const LINKED_OBJECT_TYPE_NOTE = 'note'
export const LINKED_OBJECT_TYPE_TASK = 'task'
export const LINKED_OBJECT_TYPE_GOAL = 'goal'
export const LINKED_OBJECT_TYPE_SKILL = 'skill'
export const LINKED_OBJECT_TYPE_ASSISTANT = 'assistant'

export const LINKED_PARENT_TASK = 0
export const LINKED_PARENT_NOTE = 1

export const getDvLink = (projectId, objectId, objectType) => {
    if (objectType === 'projects') {
        return `/project/${projectId}`
    } else {
        const typePath = objectType === 'users' ? 'contacts' : objectType
        return `/projects/${projectId}/${typePath}/${objectId}`
    }
}

export const getDvTabLink = (projectId, objectId, objectType, tab) => {
    return `${getDvLink(projectId, objectId, objectType)}/${tab}`
}

export const getDvMainTabLink = (projectId, objectId, objectType) => {
    const mainPathWord = {
        tasks: 'properties',
        contacts: 'properties',
        users: 'profile',
        goals: 'properties',
        skills: 'properties',
        chats: 'chat',
        notes: 'editor',
        assistants: 'customizations',
        projects: 'properties',
        preConfigTasks: 'run',
    }
    return getDvTabLink(projectId, objectId, objectType, mainPathWord[objectType])
}

export const getDvNoteTabLink = (projectId, objectId, objectType) => {
    const type = objectType === 'notes' ? 'editor' : 'note'
    return getDvTabLink(projectId, objectId, objectType, type)
}

export const getDvChatTabLink = (projectId, objectId, objectType) => {
    return getDvTabLink(projectId, objectId, objectType, 'chat')
}

const removeEndSlashs = url => {
    return url.replace(/\/+$/, '')
}

export const addProtocol = url => {
    let tmpURL = url
    if (!url.startsWith('http') && !tmpURL.startsWith('ftp') && !tmpURL.startsWith('file')) {
        tmpURL = `http://${tmpURL}`
    }
    return tmpURL
}

const checkIfIsProjectUrl = urlParts => {
    const innerPath = urlParts[3]
    return innerPath === 'project' || innerPath === 'projects'
}

const checkIfBelongsToProject = (projectId, urlParts) => {
    const urlProjectId = urlParts[4]
    const sameProjectId = urlProjectId === projectId
    return sameProjectId
}

export const checkIfUrlBelongsToProjectInTheList = (initialUrl, projectIds) => {
    let tmpUrl = initialUrl
    tmpUrl = removeEndSlashs(tmpUrl)
    tmpUrl = addProtocol(tmpUrl)
    const urlParts = tmpUrl.split('/')

    const isProjectUrl = checkIfIsProjectUrl(urlParts)
    const urlProjectId = isProjectUrl && projectIds.find(projectId => checkIfBelongsToProject(projectId, urlParts))
    return urlProjectId
}

const getLinkedParentUrl = (projectId, linkedParentObject) => {
    return `${window.location.origin}${getDvMainTabLink(
        projectId,
        linkedParentObject.id,
        `${linkedParentObject.type}s`
    )}`
}

const getUrlParts = url => {
    const urlParts = url.split('/')
    return { protocol: urlParts[0], host: urlParts[2] }
}

const isValidNoteLink = (url, projectId) => {
    return isValidLink(url, projectId, 'notes')
}

const isValidGoalLink = (url, projectId) => {
    return isValidLink(url, projectId, 'goals')
}

const isValidSkillLink = (url, projectId) => {
    return isValidLink(url, projectId, 'skills')
}

const isValidAssistantLink = (url, projectId) => {
    return isValidLink(url, projectId, 'assistants')
}

const isValidTaskLink = (url, projectId) => {
    return isValidLink(url, projectId, 'tasks')
}

const isValidContactLink = (url, projectId) => {
    return isValidLink(url, projectId, 'contacts')
}

const isValidChatLink = (url, projectId) => {
    return isValidLink(url, projectId, 'chats')
}

const isValidPreConfigTaskLink = (url, projectId) => {
    return isValidLink(url, projectId, 'preConfigTasks')
}

export const isValidProtocol = protocol => {
    return protocol === 'https:' || protocol === 'http:'
}

export const isValidHost = host => {
    return host === getAppUrlHost() || host === 'localhost:19006'
}

const isValidLink = (url, projectId, objectType) => {
    const urlParts = Array.isArray(url) ? url : url.split('/')
    return (
        isValidProtocol(urlParts[0]) &&
        isValidHost(urlParts[2]) &&
        urlParts[3] === 'projects' &&
        urlParts[4] &&
        urlParts[4] === projectId &&
        urlParts[5] === objectType &&
        urlParts[6]
    )
}

const isValidProjectLink = (url, projectId) => {
    const urlParts = Array.isArray(url) ? url : url.split('/')
    return (
        isValidProtocol(urlParts[0]) &&
        isValidHost(urlParts[2]) &&
        urlParts[3] === 'project' &&
        urlParts[4] &&
        urlParts[4] === projectId &&
        urlParts[5]
    )
}

const getUrlObject = (fullUrl, rootUrl, projectId, editorId, userIdAllowedToEditTags) => {
    const _projectId = projectId ? projectId : ProjectHelper.getCurrentProject()?.id
    const urlParts = fullUrl.split('/')
    let linkedParentObjectType = null

    if (isValidNoteLink(urlParts, _projectId)) {
        linkedParentObjectType = 'note'
    } else if (isValidTaskLink(urlParts, _projectId)) {
        linkedParentObjectType = 'task'
    } else if (isValidPreConfigTaskLink(urlParts, _projectId)) {
        linkedParentObjectType = 'preConfigTask'
    } else if (isValidContactLink(urlParts, _projectId)) {
        linkedParentObjectType = 'contact'
    } else if (isValidChatLink(urlParts, _projectId)) {
        linkedParentObjectType = 'topic'
    } else if (isValidGoalLink(urlParts, _projectId)) {
        linkedParentObjectType = 'goal'
    } else if (isValidSkillLink(urlParts, _projectId)) {
        linkedParentObjectType = 'skill'
    } else if (isValidAssistantLink(urlParts, _projectId)) {
        linkedParentObjectType = 'assistant'
    } else {
        linkedParentObjectType = 'plain'
    }

    if (linkedParentObjectType) {
        let urlBoundary = rootUrl
        let excessChars = 0
        if (linkedParentObjectType === 'plain') {
            if (fullUrl.startsWith('https://www.')) {
                excessChars = 12
            } else if (fullUrl.startsWith('https://')) {
                excessChars = 8
            } else if (fullUrl.startsWith('http://www.')) {
                excessChars = 11
            } else if (fullUrl.startsWith('http://')) {
                excessChars = 7
            }
        }
        // urlBoundary = urlBoundary.substring(1, urlBoundary.length - 1)
        if (urlBoundary.startsWith('www.')) {
            urlBoundary = urlBoundary.substr(4)
        }

        return {
            url: fullUrl,
            type: linkedParentObjectType,
            urlBoundary: fullUrl.length >= 15 + excessChars ? `${urlBoundary}...` : urlBoundary,
            id: v4(),
            editorId,
            userIdAllowedToEditTags,
            objectId: linkedParentObjectType !== 'plain' ? urlParts[6] : '',
        }
    }
}

const checkDVLink = type => {
    const { selectedNavItem } = store.getState()
    if (type === 'task' && selectedNavItem.startsWith('TASK_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_TASKS))
        NavigationService.navigate('Root')
    } else if (type === 'people' && selectedNavItem.startsWith('USER_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS))
        NavigationService.navigate('Root')
    } else if (type === 'people' && selectedNavItem.startsWith('CONTACT_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS))
        NavigationService.navigate('Root')
    } else if (type === 'project' && selectedNavItem.startsWith('PROJECT_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_TASKS))
        NavigationService.navigate('Root')
    } else if (type === 'note' && selectedNavItem.startsWith('NOTE_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_NOTES))
        NavigationService.navigate('Root')
    } else if (type === 'goal' && selectedNavItem.startsWith('GOAL_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_GOALS))
        NavigationService.navigate('Root')
    } else if (type === 'chat' && selectedNavItem.startsWith('CHAT_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_TASKS))
        NavigationService.navigate('Root')
    } else if (type === 'skill' && selectedNavItem.startsWith('SKILL_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_TASKS))
        NavigationService.navigate('Root')
    } else if (type === 'assistant' && selectedNavItem.startsWith('ASSISTANT_')) {
        store.dispatch(setSelectedSidebarTab(DV_TAB_ROOT_TASKS))
        NavigationService.navigate('Root')
    }
}

const formatUrl = plainUrl => {
    let execRes = null
    if (plainUrl.startsWith('https://')) {
        const index = plainUrl.indexOf('/', 8)
        if (index > -1) {
            execRes = plainUrl.substring(8, index)
        } else {
            execRes = plainUrl.substring(8)
        }
    } else if (plainUrl.startsWith('http://')) {
        const index = plainUrl.indexOf('/', 7)
        if (index > -1) {
            execRes = plainUrl.substring(7, index)
        } else {
            execRes = plainUrl.substring(7)
        }
    } else if (plainUrl.startsWith('www.')) {
        const index = plainUrl.indexOf('/', 4)
        if (index > -1) {
            execRes = plainUrl.substring(0, index)
            plainUrl = 'https://' + plainUrl
            plainUrl = plainUrl.substr(0, plainUrl.length - 1)
        } else {
            execRes = plainUrl
            plainUrl = 'https://' + plainUrl
        }
    } else {
        // Handle bare domain URLs like "crew.ai", "example.com/path"
        const index = plainUrl.indexOf('/')
        if (index > -1) {
            execRes = plainUrl.substring(0, index)
        } else {
            execRes = plainUrl
        }
    }

    return execRes
}

const handleNestedLinks = text => {
    const words = text.split(' ')
    let parsedText = ''
    for (let i = 0; i < words.length; i++) {
        const word = words[i]

        if (REGEX_URL.test(word)) {
            parsedText += 'LINK '
        } else {
            parsedText += `${word} `
        }
    }

    parsedText = parsedText.trim()

    return parsedText
}

export {
    formatUrl,
    getLinkedParentUrl,
    isValidNoteLink,
    isValidTaskLink,
    isValidContactLink,
    isValidProjectLink,
    isValidChatLink,
    isValidGoalLink,
    isValidSkillLink,
    isValidAssistantLink,
    isValidPreConfigTaskLink,
    getUrlObject,
    handleNestedLinks,
    checkDVLink,
    getUrlParts,
}
