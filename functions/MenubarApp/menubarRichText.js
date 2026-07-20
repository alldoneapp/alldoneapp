'use strict'

const { cleanTextMetaData, removeFormatTagsFromText } = require('../Utils/parseTextUtils')

const MAX_OBJECT_LINKS = 20
const OBJECT_ROUTE_PATTERN = /^\/projects\/([^/]+)\/(tasks|notes|goals|chats|skills|assistants|contacts)\/([^/?#]+)/

const ROUTE_CONFIG = {
    tasks: { kind: 'task', path: (projectId, objectId) => `items/${projectId}/tasks/${objectId}` },
    notes: { kind: 'note', path: (projectId, objectId) => `noteItems/${projectId}/notes/${objectId}` },
    goals: { kind: 'goal', path: (projectId, objectId) => `goals/${projectId}/items/${objectId}` },
    chats: { kind: 'topic', path: (projectId, objectId) => `chatObjects/${projectId}/chats/${objectId}` },
    skills: { kind: 'skill', path: (projectId, objectId) => `skills/${projectId}/items/${objectId}` },
    assistants: {
        kind: 'assistant',
        path: (projectId, objectId) => `assistants/${projectId}/items/${objectId}`,
    },
    contacts: {
        kind: 'contact',
        path: (projectId, objectId) => `projectsContacts/${projectId}/contacts/${objectId}`,
    },
}

function normalizeObjectTitle(value, fallback) {
    const text = cleanTextMetaData(removeFormatTagsFromText(typeof value === 'string' ? value : ''), true).trim()
    return text || fallback
}

function isObjectVisibleToUser(data, kind, userId) {
    if (!data || kind === 'assistant') return true
    const isPublicFor = Array.isArray(data.isPublicFor) ? data.isPublicFor : []

    if (kind === 'task' || kind === 'note') {
        return data.isPrivate !== true || data.userId === userId || isPublicFor.includes(userId)
    }
    if (kind === 'contact') {
        return data.isPrivate !== true || data.recorderUserId === userId || isPublicFor.includes(userId)
    }
    return isPublicFor.length === 0 || isPublicFor.includes(0) || isPublicFor.includes(userId)
}

function extractMenubarObjectLinks(text, appBaseUrl) {
    if (typeof text !== 'string' || !text) return []

    let appHost = ''
    try {
        appHost = new URL(appBaseUrl).host
    } catch (error) {
        return []
    }

    const links = []
    const seen = new Set()
    const urlPattern = /https?:\/\/[^\s<>()]+/gi
    let match
    while ((match = urlPattern.exec(text)) && links.length < MAX_OBJECT_LINKS) {
        const candidate = match[0].replace(/[.,;:!?]+$/, '')
        let parsed
        try {
            parsed = new URL(candidate)
        } catch (error) {
            continue
        }
        if (parsed.host !== appHost) continue

        const routeMatch = parsed.pathname.match(OBJECT_ROUTE_PATTERN)
        if (!routeMatch) continue
        const [, projectId, area, objectId] = routeMatch
        const config = ROUTE_CONFIG[area]
        if (!config || seen.has(candidate)) continue
        seen.add(candidate)
        links.push({ url: candidate, projectId, objectId, area, kind: config.kind })
    }
    return links
}

async function resolveMenubarRichTextLinks(db, text, userId, appBaseUrl) {
    const references = extractMenubarObjectLinks(text, appBaseUrl)
    if (references.length === 0) return []

    const projectAccess = new Map()
    const canAccessProject = projectId => {
        if (!projectAccess.has(projectId)) {
            projectAccess.set(
                projectId,
                db
                    .doc(`projects/${projectId}`)
                    .get()
                    .then(
                        doc => doc.exists && Array.isArray(doc.data()?.userIds) && doc.data().userIds.includes(userId)
                    )
            )
        }
        return projectAccess.get(projectId)
    }

    const resolved = await Promise.all(
        references.map(async reference => {
            if (!(await canAccessProject(reference.projectId))) return null
            const config = ROUTE_CONFIG[reference.area]
            let objectDoc = await db.doc(config.path(reference.projectId, reference.objectId)).get()

            if (!objectDoc.exists && reference.kind === 'assistant') {
                objectDoc = await db.doc(`assistants/globalProject/items/${reference.objectId}`).get()
            } else if (!objectDoc.exists && reference.kind === 'contact') {
                objectDoc = await db.doc(`users/${reference.objectId}`).get()
            }

            const data = objectDoc.exists ? objectDoc.data() || {} : {}
            if (objectDoc.exists && !isObjectVisibleToUser(data, reference.kind, userId)) return null
            const fallback = reference.kind.charAt(0).toUpperCase() + reference.kind.slice(1)
            const title = normalizeObjectTitle(
                data.extendedName || data.extendedTitle || data.displayName || data.title || data.name,
                fallback
            )
            return { kind: reference.kind, title, url: reference.url }
        })
    )

    return resolved.filter(Boolean)
}

module.exports = {
    extractMenubarObjectLinks,
    resolveMenubarRichTextLinks,
}
