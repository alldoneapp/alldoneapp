'use strict'

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createUserDescriptionChangedFeed, createUserGlobalDescriptionChangedFeed } = require('../Feeds/usersFeeds')
const { UserHelper } = require('./UserHelper')
const { getTaskNameWithoutMeta } = require('../Utils/HelperFunctionsCloud')

function normalizeUserDescription(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function getDirectUserDescription(userData = {}) {
    return normalizeUserDescription(userData.extendedDescription || userData.description || '')
}

function getCurrentUserDescription(projectUserData = {}, userData = {}) {
    return normalizeUserDescription(
        projectUserData.extendedDescription ||
            userData.extendedDescription ||
            projectUserData.description ||
            userData.description ||
            ''
    )
}

async function updateUserDescriptionInProject({
    db,
    projectId,
    targetUserId,
    actorUserId,
    normalizedDescription,
    userDoc = null,
    feedUser: actorFeedUser = null,
}) {
    if (!projectId || typeof projectId !== 'string') {
        throw new Error('Valid projectId is required')
    }

    const projectRef = db.collection('projects').doc(projectId)
    const resolvedUserDoc = userDoc || (await db.collection('users').doc(targetUserId).get())
    const [projectDoc] = await Promise.all([projectRef.get()])

    if (!projectDoc.exists) {
        throw new Error(`Project "${projectId}" was not found.`)
    }

    if (!resolvedUserDoc.exists) {
        throw new Error(`User "${targetUserId}" was not found.`)
    }

    const projectData = projectDoc.data() || {}
    const userData = resolvedUserDoc.data() || {}
    const projectUserData = projectData.usersData?.[targetUserId] || null
    const projectUserIds = Array.isArray(projectData.userIds) ? projectData.userIds : []

    if (!projectUserData && !projectUserIds.includes(targetUserId)) {
        throw new Error(`User "${targetUserId}" is not a member of project "${projectId}".`)
    }

    const currentDescription = getCurrentUserDescription(projectUserData || {}, userData)
    const projectName = projectData.name || projectId
    const userName = userData.displayName || userData.name || targetUserId

    if (currentDescription === normalizedDescription) {
        return {
            success: true,
            updated: false,
            scope: 'project',
            user: { id: targetUserId, name: userName },
            project: { id: projectId, name: projectName },
            description: normalizedDescription,
            previousDescription: currentDescription,
            message: `User description is already up to date for "${userName}" in project "${projectName}"`,
        }
    }

    const feedUser = actorFeedUser || (await UserHelper.getFeedUserData(db, actorUserId || targetUserId))
    const batch = new BatchWrapper(db)
    const plainDescription = getTaskNameWithoutMeta(normalizedDescription)

    batch.update(db.doc(`projects/${projectId}`), {
        [`usersData.${targetUserId}.description`]: plainDescription,
        [`usersData.${targetUserId}.extendedDescription`]: normalizedDescription,
    })
    await createUserDescriptionChangedFeed(
        projectId,
        targetUserId,
        normalizedDescription,
        currentDescription,
        batch,
        feedUser,
        false
    )
    await batch.commit()

    return {
        success: true,
        updated: true,
        scope: 'project',
        user: { id: targetUserId, name: userName },
        project: { id: projectId, name: projectName },
        description: normalizedDescription,
        previousDescription: currentDescription,
        message: `User description updated for "${userName}" in project "${projectName}"`,
    }
}

// MCP feed parity: contacts and moves
// The global description lives on users/{uid} and belongs to no project, so its Updates entry is
// written on the user in their default project, where it shows unless that project has a
// description of its own. No default project (or one the user left): no entry. Best effort: the
// description is already saved, so a failing feed is logged and the tool call goes on.
const GLOBAL_DESCRIPTION_FEED_LIMIT = 50

async function writeGlobalUserDescriptionFeed({
    db,
    userData = {},
    targetUserId,
    actorUserId,
    newDescription,
    oldDescription,
    feedUser,
}) {
    const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (!defaultProjectId) return false
    try {
        const projectDoc = await db.collection('projects').doc(defaultProjectId).get()
        const projectData = projectDoc.exists ? projectDoc.data() || {} : null
        const projectUserIds = Array.isArray(projectData?.userIds) ? projectData.userIds : []
        if (!projectData || !projectUserIds.includes(targetUserId)) return false

        const { shrinkTagText } = require('../Utils/parseTextUtils')
        const shorten = value =>
            value
                ? shrinkTagText(
                      getTaskNameWithoutMeta(value, true).replace(/\s+/g, ' ').trim(),
                      GLOBAL_DESCRIPTION_FEED_LIMIT
                  )
                : ''
        const actor = feedUser || (await UserHelper.getFeedUserData(db, actorUserId || targetUserId))
        const batch = new BatchWrapper(db)
        await createUserGlobalDescriptionChangedFeed(
            defaultProjectId,
            targetUserId,
            shorten(newDescription),
            shorten(oldDescription),
            batch,
            actor,
            false
        )
        await batch.commit()
        return true
    } catch (error) {
        console.warn('[userDescriptionUpdateHelper] Could not write the global description feed', {
            userId: targetUserId,
            projectId: defaultProjectId,
            error: error.message,
        })
        return false
    }
}

async function updateUserDescription({ db, projectId, targetUserId, actorUserId, description, feedUser = null }) {
    if (!db) {
        throw new Error('Database instance is required')
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
        throw new Error('Valid targetUserId is required')
    }

    const normalizedDescription = normalizeUserDescription(description)
    if (!normalizedDescription) {
        throw new Error('description is required for update_user_description.')
    }

    const userRef = db.collection('users').doc(targetUserId)
    const userDoc = await userRef.get()

    if (!userDoc.exists) {
        throw new Error(`User "${targetUserId}" was not found.`)
    }

    const userData = userDoc.data() || {}
    if (projectId) {
        return updateUserDescriptionInProject({
            db,
            projectId,
            targetUserId,
            actorUserId,
            normalizedDescription,
            userDoc,
            feedUser,
        })
    }

    const userName = userData.displayName || userData.name || targetUserId
    const currentGlobalDescription = getDirectUserDescription(userData)

    if (currentGlobalDescription === normalizedDescription) {
        return {
            success: true,
            updated: false,
            scope: 'global',
            user: { id: targetUserId, name: userName },
            description: normalizedDescription,
            previousDescription: currentGlobalDescription,
            message: `User description is already up to date for "${userName}"`,
        }
    }

    const batch = new BatchWrapper(db)
    const plainDescription = getTaskNameWithoutMeta(normalizedDescription)
    batch.update(db.doc(`users/${targetUserId}`), {
        description: plainDescription,
        extendedDescription: normalizedDescription,
    })

    await batch.commit()

    await writeGlobalUserDescriptionFeed({
        db,
        userData,
        targetUserId,
        actorUserId,
        newDescription: normalizedDescription,
        oldDescription: currentGlobalDescription,
        feedUser,
    })

    return {
        success: true,
        updated: true,
        scope: 'global',
        user: { id: targetUserId, name: userName },
        description: normalizedDescription,
        previousDescription: currentGlobalDescription,
        message: `User description updated globally for "${userName}"`,
    }
}

module.exports = {
    normalizeUserDescription,
    getCurrentUserDescription,
    updateUserDescription,
}
