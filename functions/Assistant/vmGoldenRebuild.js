const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

// Only project members may trigger a golden rebuild for a project.
async function assertProjectMember(projectId, userId) {
    const snap = await admin.firestore().doc(`projects/${projectId}`).get()
    if (!snap.exists) throw new HttpsError('not-found', 'Project not found.')
    const data = snap.data() || {}
    const userIds = Array.isArray(data.userIds) ? data.userIds : []
    if (!userIds.includes(userId)) {
        throw new HttpsError('permission-denied', 'You are not a member of this project.')
    }
    return data
}

/**
 * On-demand (#1) rebuild of a project's golden VM snapshot. Claims the same debounce
 * lease the drift path uses (so a manual rebuild coalesces with an in-flight one) and
 * enqueues the runGoldenBuild Cloud Tasks worker. The build itself clones + installs +
 * snapshots; it runs no agent and spends no Gold.
 */
async function rebuildProjectVmGolden({ userId, projectId }) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId) throw new HttpsError('invalid-argument', 'A projectId is required.')

    const project = await assertProjectMember(projectId, userId)
    const hasRepo = !!((project.githubRepoUrl || '').trim() || (project.gitlabRepoUrl || '').trim())
    if (!hasRepo) {
        throw new HttpsError(
            'failed-precondition',
            'Connect a GitHub or GitLab repository to this project before building its VM environment.'
        )
    }

    const golden = require('./vmGolden')
    const { claimed, buildId } = await golden.claimGoldenRebuildLease(projectId, userId, 'manual')
    if (!claimed) {
        // A build is already in flight — treat as success so the UI shows "building".
        return { success: true, alreadyBuilding: true }
    }
    try {
        await golden.enqueueGoldenRebuild(projectId, buildId, userId)
    } catch (error) {
        await golden.releaseGoldenRebuildLease(projectId, buildId, `enqueue failed: ${error.message}`)
        throw new HttpsError('unavailable', 'Could not enqueue the VM environment build. Please try again.')
    }
    return { success: true, buildId, alreadyBuilding: false }
}

module.exports = { rebuildProjectVmGolden }
