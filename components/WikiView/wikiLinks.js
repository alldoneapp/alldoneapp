import NavigationService from '../../utils/NavigationService'
import { DV_TAB_PROJECT_WIKI } from '../../utils/TabNavigationConstants'

// The navigation helpers are required on use: this module is imported by the task board's more
// menu and by the wiki view, and URLTrigger reaches the whole URL system, the store and, through
// it, the root views — the wiki view among them.
const getURLTrigger = () => require('../../URLSystem/URLTrigger').default
const getProjectHelper = () => require('../SettingsView/ProjectsSettings/ProjectHelper').default
const getDvMainTabLink = (...args) => require('../../utils/LinkingHelper').getDvMainTabLink(...args)
const getDvChatTabLink = (...args) => require('../../utils/LinkingHelper').getDvChatTabLink(...args)
const getChatMeta = (...args) => require('../../utils/backends/Chats/chatsFirestore').getChatMeta(...args)

const SOURCE_OBJECT_TYPES = {
    task: 'tasks',
    note: 'notes',
    goal: 'goals',
    contact: 'contacts',
}

// Where a comment thread is read: a topic in Chats, any other thread in the chat tab of its object.
export function getWikiThreadPath(projectId, chatId, threadType) {
    if (threadType === 'topics') return getDvChatTabLink(projectId, chatId, 'chats')
    if (threadType === 'artifacts') return `/projects/${projectId}/artifacts/${chatId}/chat`
    if (Object.values(SOURCE_OBJECT_TYPES).includes(threadType)) return getDvChatTabLink(projectId, chatId, threadType)
    return null
}

// A thread source names only its chat object, so which kind of thread it is is read on press.
async function openWikiThread(projectId, chatId) {
    try {
        const chat = await getChatMeta(projectId, chatId)
        const path = chat ? getWikiThreadPath(projectId, chatId, chat.type) : null
        if (path) getURLTrigger().processUrl(NavigationService, path)
    } catch (error) {
        console.warn('[wiki] Could not open the conversation a page cites', error?.message)
    }
}

export function getProjectWikiPath(projectId, slug = null, revision = null) {
    const page = slug ? `/${slug}${revision ? `/changes/${revision}` : ''}` : ''
    return `/projects/${projectId}/wiki${page}`
}

// Everything a page changed since one of its revisions, as one comparison (AT-2878).
export function getProjectWikiChangesSincePath(projectId, slug, since) {
    return `${getProjectWikiPath(projectId, slug)}/changes/since/${since}`
}

export function openProjectWiki(projectId, slug = null) {
    if (!projectId) return
    getURLTrigger().processUrl(NavigationService, getProjectWikiPath(projectId, slug))
}

// What one revision of a page changed: where a wiki line in the Updates feed leads.
export function openProjectWikiChange(projectId, slug, revision) {
    if (!projectId || !slug || !revision) return
    getURLTrigger().processUrl(NavigationService, getProjectWikiPath(projectId, slug, revision))
}

export function openProjectWikiSettings(projectId) {
    if (!projectId) return
    getProjectHelper().processURLProjectDetailsTab(NavigationService, DV_TAB_PROJECT_WIKI, projectId)
}

// A source reference opens the object it cites. Corrections have no view of their own.
export function openWikiSource(projectId, source) {
    if (projectId && source?.id && source.objectType === 'artifact') {
        getURLTrigger().processUrl(NavigationService, `/projects/${projectId}/artifacts/${source.id}`)
        return true
    }
    if (projectId && source?.id && source.objectType === 'chat') {
        openWikiThread(projectId, source.id)
        return true
    }
    const objectType = SOURCE_OBJECT_TYPES[source?.objectType]
    if (!projectId || !objectType || !source.id) return false
    getURLTrigger().processUrl(NavigationService, getDvMainTabLink(projectId, source.id, objectType))
    return true
}
