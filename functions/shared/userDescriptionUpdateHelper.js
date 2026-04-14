'use strict'

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createUserDescriptionChangedFeed } = require('../Feeds/usersFeeds')
const { UserHelper } = require('./UserHelper')
const { getTaskNameWithoutMeta } = require('../Utils/HelperFunctionsCloud')

function normalizeUserDescription(value) {
    return typeof value === 'string' ? value.trim() : ''
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

async function updateUserDescription({ db, projectId, targetUserId, actorUserId, description }) {
    if (!db) {
        throw new Error('Database instance is required')
    }

    if (!projectId || typeof projectId !== 'string') {
        throw new Error('Valid projectId is required')
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
        throw new Error('Valid targetUserId is required')
    }

    const normalizedDescription = normalizeUserDescription(description)
    if (!normalizedDescription) {
        throw new Error('description is required for update_user_description.')
    }

    const projectRef = db.collection('projects').doc(projectId)
    const userRef = db.collection('users').doc(targetUserId)
    const [projectDoc, userDoc] = await Promise.all([projectRef.get(), userRef.get()])

    if (!projectDoc.exists) {
        throw new Error(`Project "${projectId}" was not found.`)
    }

    if (!userDoc.exists) {
        throw new Error(`User "${targetUserId}" was not found.`)
    }

    const projectData = projectDoc.data() || {}
    const userData = userDoc.data() || {}
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
            user: { id: targetUserId, name: userName },
            project: { id: projectId, name: projectName },
            description: normalizedDescription,
            previousDescription: currentDescription,
            message: `User description is already up to date for "${userName}" in project "${projectName}"`,
        }
    }

    const feedUser = await UserHelper.getFeedUserData(db, actorUserId || targetUserId)
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
        user: { id: targetUserId, name: userName },
        project: { id: projectId, name: projectName },
        description: normalizedDescription,
        previousDescription: currentDescription,
        message: `User description updated for "${userName}" in project "${projectName}"`,
    }
}

module.exports = {
    normalizeUserDescription,
    getCurrentUserDescription,
    updateUserDescription,
}
