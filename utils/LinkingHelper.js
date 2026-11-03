import v4 from 'uuid/v4'
import ProjectHelper from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import { getAppUrlHost, getHostingUrl } from './backends/firestore'
import { handleNestedLinks } from './nestedLinkText'
import { isCapacitorShell } from './CapacitorShell'

export const LINKED_OBJECT_TYPE_CONTACT = 'contact'
export const LINKED_OBJECT_TYPE_PROJECT = 'project'
export const LINKED_OBJECT_TYPE_NOTE = 'note'
export const LINKED_OBJECT_TYPE_TASK = 'task'
export const LINKED_OBJECT_TYPE_GOAL = 'goal'
export const LINKED_OBJECT_TYPE_SKILL = 'skill'
export const LINKED_OBJECT_TYPE_ASSISTANT = 'assistant'
export const LINKED_OBJECT_TYPE_ARTIFACT = 'artifact'

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

const isValidArtifactLink = (url, projectId) => {
    return isValidLink(url, projectId, 'artifacts')
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

// The iOS app (ios-app/, Capacitor) serves the web bundle from `capacitor://localhost`, so every
// link it ever built from `window.location.origin` reads `capacitor://localhost/projects/...`
// (AT-2950). Those links are already stored in notes and comments, and they point at the same
// app routes as a my.alldone.app link, so they are recognised as internal links everywhere.
export const APP_SHELL_PROTOCOL = 'capacitor:'
export const APP_SHELL_HOST = 'localhost'

const isAppShellOrigin = (protocol, host) => {
    return String(protocol || '').toLowerCase() === APP_SHELL_PROTOCOL && host === APP_SHELL_HOST
}

/** True for an origin the app itself is served from: the hosting URL, local dev, or the iOS shell. */
export const isAppLinkOrigin = (protocol, host) => {
    return (isValidProtocol(protocol) && isValidHost(host)) || isAppShellOrigin(protocol, host)
}

/**
 * The pathname of a link that points into this app, or null for anything else.
 *
 * Unlike a bare `new URL(addProtocol(url))`, this understands the iOS shell's custom scheme:
 * `addProtocol` prefixes `http://` to it, which parses `capacitor` as the host and makes the
 * link look external (AT-2950).
 */
export const getAppLinkPathname = url => {
    if (typeof url !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim())) return null
    try {
        const parsed = new URL(url.trim())
        return isAppLinkOrigin(parsed.protocol, parsed.host) ? parsed.pathname : null
    } catch (error) {
        return null
    }
}

const DEFAULT_APP_LINK_ORIGIN = 'https://my.alldone.app'

const getHostingOrigin = () => {
    try {
        const hostingUrl = typeof getHostingUrl === 'function' ? getHostingUrl() : ''
        if (hostingUrl) return new URL(addProtocol(hostingUrl)).origin
    } catch (error) {
        // Fall through to the production origin below.
    }
    return DEFAULT_APP_LINK_ORIGIN
}

/**
 * The origin to put in front of an app route when the link is STORED (a mention, a link chip).
 *
 * In a browser that is the page's own origin, as before. Inside the iOS shell it is the hosting
 * URL: a `capacitor://localhost` link only means something inside that one app, and a note
 * mention written there must still resolve to its note on the web and on every other device
 * (AT-2950).
 */
export const getAppLinkOrigin = () => {
    const location = typeof window !== 'undefined' ? window.location : null
    if (location && isValidProtocol(location.protocol) && !isCapacitorShell()) return location.origin
    return getHostingOrigin()
}

const isValidLink = (url, projectId, objectType) => {
    const urlParts = Array.isArray(url) ? url : url.split('/')
    return (
        isAppLinkOrigin(urlParts[0], urlParts[2]) &&
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
        isAppLinkOrigin(urlParts[0], urlParts[2]) &&
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
    } else if (isValidArtifactLink(urlParts, _projectId)) {
        linkedParentObjectType = 'artifact'
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

/**
 * The object type of a stored link chip, decided from the link itself rather than from the
 * editor it happens to sit in.
 *
 * `getUrlObject` only types a link of the project it is given, so a chip stored as `plain`
 * may still point at a note: a link pasted from another project, one an assistant wrote, or one
 * created in the iOS shell before its origin was recognised (AT-2950). Rendering re-derives the
 * type with the link's OWN project, so every such chip shows its object again without touching
 * the stored document. Returns null for anything that is not a typed app link.
 */
export const getInternalLinkType = url => {
    if (typeof url !== 'string' || url === '') return null
    const urlParts = url.split('/')
    const linkProjectId = urlParts[3] === 'projects' ? urlParts[4] : ''
    if (!linkProjectId) return null
    const urlObject = getUrlObject(url, formatUrl(url) || '', linkProjectId, '', '')
    return urlObject && urlObject.type !== 'plain' ? urlObject.type : null
}

// `checkDVLink` lived here until AT-2417 and is deliberately gone. It bounced every
// detailed-view link through the matching ROOT LIST (`setSelectedSidebarTab` +
// `NavigationService.navigate('Root')`) before the URL system navigated to the target,
// which is why opening a note showed the notes list first. It was a June-2021 workaround
// for react-navigation: back then `NavigationService.navigate` was a plain
// `NavigationActions.navigate`, so navigating from a DV to another DV of the SAME route
// name did not remount the screen or re-read its params — the bounce forced a real route
// change. #7524 (June 2022) made `navigate` a `StackActions.reset` with a changing key,
// and the Stage 2 rewrite kept that contract explicitly: NavigationService increments
// `id` on every navigate and AppNavigator renders the screen under `key={id}`, so EVERY
// navigation already remounts the subtree with fresh params. The bounce has therefore
// been dead weight since 2022, while still costing a full mount of the wrong list — which
// `URLsNotes.push`/`URLsTasks.push` etc. record as a junk browser-history entry, so Back
// landed on that list instead of where the user came from.
//
// It was also driven by STALE state: nothing resets `selectedNavItem` to a `ROOT_*` value
// when you leave a DV for a root list, so after opening any note once, `selectedNavItem`
// stayed `NOTE_EDITOR` for the rest of the session and a note link clicked in the TASK
// LIST still took the note-to-note branch. That is the exact reported symptom.
//
// Do not reintroduce it: a link to a DV must navigate straight to that DV.

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

// `handleNestedLinks` used to live here and replaced every URL-looking word in an
// object title with the literal string `LINK` (AT-2470). It moved to the pure leaf
// module `./nestedLinkText` — see the header comment there for why the placeholder was
// wrong for real URLs AND for ordinary words like `package.json`. It is re-exported
// unchanged below so no call site had to move.

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
    isValidArtifactLink,
    isValidPreConfigTaskLink,
    getUrlObject,
    handleNestedLinks,
    getUrlParts,
}
