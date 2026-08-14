'use strict'

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
const { createProjectAutoArchivedFeed } = require('../Feeds/projectsFeeds')
const { loadFeedsGlobalState } = require('../GlobalState/globalState')

const AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT = 30
const AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER = 0
const DAY_MS = 24 * 60 * 60 * 1000
const ACTIVE_USER_WINDOW_MS = 30 * DAY_MS
const ALLOWED_AUTO_ARCHIVE_VALUES = new Set([0, 30, 60, 90, 180, 365])

function normalizeAutoArchiveProjectsAfterDays(value) {
    const parsedValue = Number(value)
    return ALLOWED_AUTO_ARCHIVE_VALUES.has(parsedValue) ? parsedValue : AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT
}

function getTimestampMillis(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    if (value instanceof Date) return value.getTime()
    return null
}

function getEligibleProjectIds(userData = {}) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const archivedProjectIds = new Set(Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : [])
    const templateProjectIds = new Set(Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : [])
    const guideProjectIds = new Set(Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : [])

    return projectIds.filter(
        projectId =>
            projectId &&
            projectId !== userData.defaultProjectId &&
            !archivedProjectIds.has(projectId) &&
            !templateProjectIds.has(projectId) &&
            !guideProjectIds.has(projectId)
    )
}

function shouldAutoArchiveProject(projectData = {}, inactiveDays, now = Date.now()) {
    if (projectData.isTemplate === true || projectData.parentTemplateId) return false
    const lastActionDate = getTimestampMillis(projectData.lastActionDate ?? projectData.created)
    if (lastActionDate === null) return false
    return lastActionDate <= now - inactiveDays * DAY_MS
}

async function getRecentlyActiveUsers(now = Date.now(), db = admin.firestore()) {
    const snapshot = await db
        .collection('users')
        .where('lastLogin', '>=', now - ACTIVE_USER_WINDOW_MS)
        .get()

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
}

async function archiveProjectForUser({ userId, userData, projectId, projectData, inactiveDays, db }) {
    const feedUser = {
        uid: userId,
        displayName: userData.displayName || '',
        photoURL: userData.photoURL || '',
        dateFormat: userData.dateFormat || null,
    }
    const project = { id: projectId, ...projectData }

    loadFeedsGlobalState(admin, admin, feedUser, project, [], null)

    const batch = new BatchWrapper(db)
    batch.setProjectContext(projectId)
    batch.update(db.doc(`users/${userId}`), {
        archivedProjectIds: FieldValue.arrayUnion(projectId),
    })
    await createProjectAutoArchivedFeed(projectId, project, inactiveDays, batch, feedUser)
    await batch.commit()
}

async function processUserAutoArchive(userId, initialUserData = {}, now = Date.now(), db = admin.firestore()) {
    const inactiveDays = normalizeAutoArchiveProjectsAfterDays(initialUserData.autoArchiveProjectsAfterDays)
    if (inactiveDays === AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER) {
        return { processed: false, reason: 'disabled', archivedCount: 0 }
    }

    let archivedCount = 0
    const candidateProjectIds = getEligibleProjectIds(initialUserData)

    for (const projectId of candidateProjectIds) {
        // Re-read both documents immediately before the write. This keeps a newly selected
        // default project permanently out of the automatic path and avoids archiving a project
        // that received activity while this scheduled run was already in progress.
        const [userDoc, projectDoc] = await Promise.all([
            db.doc(`users/${userId}`).get(),
            db.doc(`projects/${projectId}`).get(),
        ])
        if (!userDoc.exists || !projectDoc.exists) continue

        const userData = userDoc.data() || {}
        if (!getEligibleProjectIds(userData).includes(projectId)) continue

        const currentInactiveDays = normalizeAutoArchiveProjectsAfterDays(userData.autoArchiveProjectsAfterDays)
        if (currentInactiveDays === AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER) continue

        const projectData = projectDoc.data() || {}
        if (!shouldAutoArchiveProject(projectData, currentInactiveDays, now)) continue

        await archiveProjectForUser({ userId, userData, projectId, projectData, inactiveDays: currentInactiveDays, db })
        archivedCount++
    }

    return { processed: true, reason: 'completed', archivedCount }
}

async function checkAndAutoArchiveProjects(now = Date.now(), db = admin.firestore()) {
    const activeUsers = await getRecentlyActiveUsers(now, db)
    let processedUsers = 0
    let skippedUsers = 0
    let archivedProjects = 0

    for (const userData of activeUsers) {
        try {
            const result = await processUserAutoArchive(userData.id, userData, now, db)
            if (result.processed) processedUsers++
            else skippedUsers++
            archivedProjects += result.archivedCount || 0
        } catch (error) {
            skippedUsers++
            console.error('[autoArchiveProjectsCloud] Failed to process user', {
                userId: userData.id,
                error: error.message,
            })
        }
    }

    console.log('[autoArchiveProjectsCloud] Completed run', {
        activeUsers: activeUsers.length,
        processedUsers,
        skippedUsers,
        archivedProjects,
    })

    return {
        success: true,
        activeUsers: activeUsers.length,
        processedUsers,
        skippedUsers,
        archivedProjects,
    }
}

module.exports = {
    AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_DEFAULT,
    AUTO_ARCHIVE_PROJECTS_AFTER_DAYS_NEVER,
    normalizeAutoArchiveProjectsAfterDays,
    getTimestampMillis,
    getEligibleProjectIds,
    shouldAutoArchiveProject,
    getRecentlyActiveUsers,
    archiveProjectForUser,
    processUserAutoArchive,
    checkAndAutoArchiveProjects,
}
