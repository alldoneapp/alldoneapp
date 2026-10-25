import NavigationService from '../../utils/NavigationService'
import { DV_TAB_PROJECT_WIKI } from '../../utils/TabNavigationConstants'

// The navigation helpers are required on use: this module is imported by the task board's more
// menu and by the wiki view, and URLTrigger reaches the whole URL system, the store and, through
// it, the root views — the wiki view among them.
const getURLTrigger = () => require('../../URLSystem/URLTrigger').default
const getProjectHelper = () => require('../SettingsView/ProjectsSettings/ProjectHelper').default
const getDvMainTabLink = (...args) => require('../../utils/LinkingHelper').getDvMainTabLink(...args)

const SOURCE_OBJECT_TYPES = {
    task: 'tasks',
    note: 'notes',
    goal: 'goals',
    contact: 'contacts',
}

export function getProjectWikiPath(projectId, slug = null, revision = null) {
    const page = slug ? `/${slug}${revision ? `/changes/${revision}` : ''}` : ''
    return `/projects/${projectId}/wiki${page}`
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
    const objectType = SOURCE_OBJECT_TYPES[source?.objectType]
    if (!projectId || !objectType || !source.id) return false
    getURLTrigger().processUrl(NavigationService, getDvMainTabLink(projectId, source.id, objectType))
    return true
}
