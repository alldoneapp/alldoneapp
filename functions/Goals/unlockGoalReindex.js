'use strict'

// Security audit 2026-11 (#16): `proccessAlgoliaRecordsWhenUnlockGoalSecondGen` re-indexes a goal and
// all of its tasks into global search after the goal is unlocked. It took any projectId/goalId from
// any signed-in user, so anybody could make the server read another workspace's goal and tasks and
// write them into the search index. It now acts only for a member of that project, on a goal that
// exists there.

const { isProjectMemberData } = require('../shared/privacyAccess')

class UnlockGoalReindexError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const isPathSegment = value =>
    typeof value === 'string' && value.trim().length > 0 && !value.includes('/') && value.length <= 200

async function reindexUnlockedGoalForUser({ db, userId, projectId, goalId, reindex }) {
    if (!userId) throw new UnlockGoalReindexError('unauthenticated', 'Sign in required')
    if (!isPathSegment(projectId) || !isPathSegment(goalId)) {
        throw new UnlockGoalReindexError('invalid-argument', 'projectId and goalId are required')
    }
    const [projectDoc, goalDoc] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.doc(`goals/${projectId}/items/${goalId}`).get(),
    ])
    if (!projectDoc.exists || !isProjectMemberData(projectDoc.data(), userId)) {
        throw new UnlockGoalReindexError('permission-denied', 'No access to this project')
    }
    if (!goalDoc.exists) throw new UnlockGoalReindexError('not-found', 'Goal not found')
    await reindex(projectId, goalId)
    return { success: true }
}

module.exports = { UnlockGoalReindexError, reindexUnlockedGoalForUser }
