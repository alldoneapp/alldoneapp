// AT-2903 — which project the assistant chat continues in, and who answers there.
//
// Pure functions over the redux state shape plus a small localStorage record.
// Deliberately free of ProjectHelper/assistantsHelper: both reach the firestore
// client and react-native-gesture-handler through their imports.

const PREFIX = 'alldone.annaProject.v1:'
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const keyFor = userId => `${PREFIX}${encodeURIComponent(userId)}`
const list = value => (Array.isArray(value) ? value : [])

/**
 * AT-3024 — the "Automatic" entry of the switcher, and its default. It is not a
 * project: it continues the default project's daily chat, where the assistant picks
 * the project for each task itself (`projectRoutingReason`). The ':' keeps it from
 * ever passing `validId`, so it is never stored or sent as a project id.
 */
export const ANNA_AUTOMATIC_PROJECT = ':automatic'

/** Active member projects only: no archived, template or guide projects. */
export const isAnnaProjectSelectable = (user = {}, projectId) =>
    validId(projectId) &&
    (projectId === user.defaultProjectId ||
        (list(user.projectIds).includes(projectId) &&
            !list(user.archivedProjectIds).includes(projectId) &&
            !list(user.templateProjectIds).includes(projectId) &&
            !list(user.guideProjectIds).includes(projectId)))

/**
 * The assistant that answers in a project's chat. Mirrors the server
 * (`findProjectAssistantId` in functions/Assistant/annaWorkspace.js) and the app's
 * `resolveDefaultAssistantForProject`: the project's flagged default assistant,
 * then its configured `project.assistantId`, otherwise the user's default assistant.
 * The server stays authoritative; this only previews the answer before it arrives.
 */
export const resolveAnnaProjectAssistant = ({
    project,
    defaultProjectId,
    projectAssistants = {},
    globalAssistants = [],
    defaultAssistant = null,
}) => {
    const fallback = { assistant: defaultAssistant, isProjectAssistant: false }
    if (!project?.id || project.id === defaultProjectId) return fallback
    const own = list(projectAssistants[project.id])
    const flagged = own.find(assistant => assistant?.isDefault && assistant.uid)
    if (flagged) return { assistant: flagged, isProjectAssistant: true }
    const configuredId = typeof project.assistantId === 'string' ? project.assistantId.trim() : ''
    if (configuredId) {
        const configured =
            own.find(assistant => assistant?.uid === configuredId) ||
            list(globalAssistants).find(assistant => assistant?.uid === configuredId)
        if (configured) return { assistant: configured, isProjectAssistant: true }
    }
    return fallback
}

/**
 * The projects offered by the switcher: "Automatic" (AT-3024), the default project,
 * then the sidebar order (`ProjectHelper.sortProjects`: sort index desc, then name).
 * "Automatic" is only offered when there is a project to choose between.
 */
export const getAnnaProjectChoices = ({
    user = {},
    projectsMap = {},
    projectAssistants = {},
    globalAssistants = [],
    defaultAssistant = null,
}) => {
    const ids = [...new Set([user.defaultProjectId, ...list(user.projectIds)])].filter(id =>
        isAnnaProjectSelectable(user, id)
    )
    const projects = ids.map(id => projectsMap[id]).filter(project => project?.id)
    const sortIndex = project => Number(project.sortIndexByUser?.[user.uid]) || 0
    projects.sort((a, b) => {
        if (a.id === user.defaultProjectId) return -1
        if (b.id === user.defaultProjectId) return 1
        return sortIndex(b) - sortIndex(a) || (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    })
    const choices = projects.map(project => {
        const { assistant, isProjectAssistant } = resolveAnnaProjectAssistant({
            project,
            defaultProjectId: user.defaultProjectId,
            projectAssistants,
            globalAssistants,
            defaultAssistant,
        })
        return {
            id: project.id,
            name: project.name || '',
            color: project.color || '',
            isDefault: project.id === user.defaultProjectId,
            // The daily chat follows project sharing, so teammates can read it.
            isShared: list(project.userIds).filter(id => id !== user.uid).length > 0,
            assistant,
            isProjectAssistant,
        }
    })
    const home = choices[0]
    if (choices.length < 2 || !home?.isDefault) return choices
    return [
        {
            ...home,
            id: ANNA_AUTOMATIC_PROJECT,
            name: '',
            color: '',
            isDefault: false,
            isAutomatic: true,
            projectId: home.id,
        },
        ...choices,
    ]
}

/** A selection is valid for the local day it was made on (until midnight). */
export const readAnnaProjectSelection = (userId, today) => {
    if (!validId(userId) || !today) return null
    try {
        const stored = JSON.parse(localStorage.getItem(keyFor(userId)) || 'null')
        if (!stored || !validId(stored.projectId) || stored.dateKey !== today) return null
        return { projectId: stored.projectId, dateKey: stored.dateKey }
    } catch (_) {
        return null
    }
}

export const saveAnnaProjectSelection = (userId, projectId, today) => {
    if (!validId(userId)) return
    try {
        if (validId(projectId) && today)
            localStorage.setItem(keyFor(userId), JSON.stringify({ projectId, dateKey: today }))
        else localStorage.removeItem(keyFor(userId))
    } catch (_) {
        // Blocked storage only means the choice does not survive a reload.
    }
}
