'use strict'

const FEED_PUBLIC_FOR_ALL = 0
const GLOBAL_PROJECT_ID = 'globalProject'

function getAccessibleProjectIdsFromUserData(userData = {}) {
    const allIds = new Set()
    ;['projectIds', 'guideProjectIds', 'templateProjectIds', 'archivedProjectIds'].forEach(key => {
        const ids = userData?.[key]
        if (!Array.isArray(ids)) return
        ids.forEach(id => {
            if (typeof id === 'string' && id.trim()) allIds.add(id.trim())
        })
    })
    return Array.from(allIds)
}

async function getUserDataOrThrow(db, userId) {
    const userDoc = await db.collection('users').doc(userId).get()
    if (!userDoc.exists) {
        throw new Error('User not found')
    }
    return userDoc.data() || {}
}

async function assertProjectAccess(db, userId, projectId) {
    if (!userId) throw new Error('Authenticated user is required')
    if (!projectId) throw new Error('projectId is required')

    const userData = await getUserDataOrThrow(db, userId)
    const accessibleProjectIds = getAccessibleProjectIdsFromUserData(userData)

    if (!accessibleProjectIds.includes(projectId)) {
        throw new Error('User does not have access to this project')
    }

    return userData
}

function canAccessObject(objectData, userId) {
    if (!objectData) return false
    const isPublicFor = Array.isArray(objectData.isPublicFor) ? objectData.isPublicFor : []
    return isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || (!!userId && isPublicFor.includes(userId))
}

function filterReadableObjects(objects, userId) {
    return Array.isArray(objects) ? objects.filter(object => canAccessObject(object, userId)) : []
}

function getObjectDocPath(projectId, objectType, objectId) {
    const normalizedType = String(objectType || '').trim()
    if (!projectId || !objectId) return null

    switch (normalizedType) {
        case 'tasks':
        case 'task':
            return `items/${projectId}/tasks/${objectId}`
        case 'notes':
        case 'note':
            return `noteItems/${projectId}/notes/${objectId}`
        case 'goals':
        case 'goal':
            return `goals/${projectId}/items/${objectId}`
        case 'contacts':
        case 'contact':
            return `projectsContacts/${projectId}/contacts/${objectId}`
        case 'skills':
        case 'skill':
            return `skills/${projectId}/items/${objectId}`
        case 'chats':
        case 'topics':
        case 'chat':
        case 'topic':
            return `chatObjects/${projectId}/chats/${objectId}`
        case 'assistants':
        case 'assistant':
            return projectId === GLOBAL_PROJECT_ID
                ? `assistants/${GLOBAL_PROJECT_ID}/items/${objectId}`
                : `assistants/${projectId}/items/${objectId}`
        case 'projects':
        case 'project':
            return `projects/${projectId}`
        case 'users':
        case 'user':
        case 'people':
            return `users/${objectId}`
        default:
            return null
    }
}

async function assertObjectAccess(db, userId, projectId, objectType, objectId) {
    await assertProjectAccess(db, userId, projectId)

    const path = getObjectDocPath(projectId, objectType, objectId)
    if (!path) {
        throw new Error('Unsupported object type for access check')
    }

    const normalizedType = String(objectType || '').trim()
    if (
        path === `projects/${projectId}` ||
        path === `users/${objectId}` ||
        normalizedType === 'assistants' ||
        normalizedType === 'assistant'
    ) {
        return true
    }

    const objectDoc = await db.doc(path).get()
    if (!objectDoc.exists) {
        throw new Error('Object not found')
    }

    const objectData = objectDoc.data() || {}
    if (!canAccessObject(objectData, userId)) {
        throw new Error('User does not have access to this object')
    }

    return true
}

module.exports = {
    FEED_PUBLIC_FOR_ALL,
    getAccessibleProjectIdsFromUserData,
    assertProjectAccess,
    canAccessObject,
    filterReadableObjects,
    getObjectDocPath,
    assertObjectAccess,
}
