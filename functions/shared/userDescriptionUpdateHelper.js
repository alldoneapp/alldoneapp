'use strict'

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createUserDescriptionChangedFeed } = require('../Feeds/usersFeeds')
const { ProjectService } = require('./ProjectService')
const { UserHelper } = require('./UserHelper')
const { getTaskNameWithoutMeta } = require('../Utils/HelperFunctionsCloud')

function normalizeUserDescription(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function getDirectUserDescription(userData = {}) {
    return normalizeUserDescription(userData.extendedDescription || userData.description || '')
}

function getDirectProjectUserDescription(projectUserData = {}) {
    return normalizeUserDescription(projectUserData.extendedDescription || projectUserData.description || '')
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
        scope: 'project',
        user: { id: targetUserId, name: userName },
        project: { id: projectId, name: projectName },
        description: normalizedDescription,
        previousDescription: currentDescription,
        message: `User description updated for "${userName}" in project "${projectName}"`,
    }
}

async function updateUserDescription({ db, projectId, targetUserId, actorUserId, description }) {
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
        })
    }

    const userName = userData.displayName || userData.name || targetUserId
    const currentGlobalDescription = getDirectUserDescription(userData)
    const projectService = new ProjectService({ database: db })
    await projectService.initialize()
    const candidateProjects = await projectService.getUserProjects(targetUserId)
    const projectDocs = await Promise.all(
        candidateProjects.map(project =>
            db
                .collection('projects')
                .doc(project.id)
                .get()
                .catch(() => null)
        )
    )
    const projectsToSync = []

    for (let index = 0; index < projectDocs.length; index++) {
        const projectDoc = projectDocs[index]
        if (!projectDoc?.exists) continue

        const projectData = projectDoc.data() || {}
        const projectUserData = projectData.usersData?.[targetUserId] || null
        const projectUserIds = Array.isArray(projectData.userIds) ? projectData.userIds : []
        if (!projectUserData && !projectUserIds.includes(targetUserId)) continue

        const currentProjectDescription = getDirectProjectUserDescription(projectUserData || {})
        if (currentProjectDescription === normalizedDescription) continue

        projectsToSync.push({
            id: candidateProjects[index].id,
            name: projectData.name || candidateProjects[index].name || candidateProjects[index].id,
            previousDescription: currentProjectDescription,
        })
    }

    if (currentGlobalDescription === normalizedDescription && projectsToSync.length === 0) {
        return {
            success: true,
            updated: false,
            scope: 'global',
            user: { id: targetUserId, name: userName },
            description: normalizedDescription,
            previousDescription: currentGlobalDescription,
            projectsUpdated: [],
            message: `User description is already up to date for "${userName}"`,
        }
    }

    const batch = new BatchWrapper(db)
    const plainDescription = getTaskNameWithoutMeta(normalizedDescription)
    const globalDescriptionChanged = currentGlobalDescription !== normalizedDescription

    if (globalDescriptionChanged) {
        batch.update(db.doc(`users/${targetUserId}`), {
            description: plainDescription,
            extendedDescription: normalizedDescription,
        })
    }

    if (projectsToSync.length > 0) {
        const feedUser = await UserHelper.getFeedUserData(db, actorUserId || targetUserId)

        for (const project of projectsToSync) {
            batch.update(db.doc(`projects/${project.id}`), {
                [`usersData.${targetUserId}.description`]: plainDescription,
                [`usersData.${targetUserId}.extendedDescription`]: normalizedDescription,
            })
            await createUserDescriptionChangedFeed(
                project.id,
                targetUserId,
                normalizedDescription,
                project.previousDescription,
                batch,
                feedUser,
                false
            )
        }
    }

    await batch.commit()

    return {
        success: true,
        updated: true,
        scope: 'global',
        user: { id: targetUserId, name: userName },
        description: normalizedDescription,
        previousDescription: currentGlobalDescription,
        projectsUpdated: projectsToSync.map(project => ({ id: project.id, name: project.name })),
        message: `User description updated globally for "${userName}"`,
    }
}

module.exports = {
    normalizeUserDescription,
    getCurrentUserDescription,
    updateUserDescription,
}
