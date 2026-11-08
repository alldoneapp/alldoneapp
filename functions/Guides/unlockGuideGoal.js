'use strict'

/**
 * Unlocking a locked goal in a guide (AT-2978, security decision 2 of the 2026-11 audit).
 *
 * The browser used to charge the 80 Gold through deductGoldSecondGen and then write the goal's
 * `lockKey` into `users/{uid}.unlockedKeysByGuides` itself, so the key could be written without the
 * charge. The charge and the key are now one server transaction, and firestore.rules no longer let a
 * client add a key (it may still remove a project's keys when it leaves the project).
 *
 * Who gets the key is the same as before: a member unlocks for themselves; the guide's creator (the
 * administrator, or a user who owns the template the guide came from) unlocks for the goal's owner,
 * so the owner's tasks show up unlocked for everybody. The caller pays either way. The lock key and
 * the owner are read from the stored goal, never taken from the request.
 *
 * The goal content itself stays readable for members in Firestore; decision 2 was to stop paying
 * being skippable, not to hide the content.
 */

const { FieldValue } = require('firebase-admin/firestore')
const { applyGoldChangeInTransaction } = require('../Gold/goldTransactions')

// Must equal UNLOCK_GOAL_COST in components/Guides/guidesHelper.js (pinned by the test).
const GOAL_UNLOCK_GOLD = 80

class UnlockGoalError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

const isPlainId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

function hasLockKey(userData, projectId, lockKey) {
    const keys = userData?.unlockedKeysByGuides?.[projectId]
    return Array.isArray(keys) && keys.includes(lockKey)
}

async function unlockGuideGoal({ db, callerId, projectId, goalId }) {
    if (!callerId) throw new UnlockGoalError('unauthenticated', 'Sign in first.')
    if (!isPlainId(projectId) || !isPlainId(goalId)) throw new UnlockGoalError('invalid-argument', 'Invalid goal.')

    const [projectDoc, goalDoc, callerDoc, adminRoleDoc] = await Promise.all([
        db.doc(`projects/${projectId}`).get(),
        db.doc(`goals/${projectId}/items/${goalId}`).get(),
        db.doc(`users/${callerId}`).get(),
        db.doc('roles/administrator').get(),
    ])

    const memberIds = projectDoc.exists && Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    if (!memberIds.includes(callerId)) throw new UnlockGoalError('permission-denied', 'You are not in this project.')
    if (!goalDoc.exists) throw new UnlockGoalError('not-found', 'This goal no longer exists.')
    if (!callerDoc.exists) throw new UnlockGoalError('not-found', 'User not found.')

    const goal = goalDoc.data() || {}
    const lockKey = typeof goal.lockKey === 'string' ? goal.lockKey : ''
    if (!lockKey) return { success: true, alreadyUnlocked: true, notLocked: true }

    const caller = callerDoc.data() || {}
    const isCreator =
        (adminRoleDoc.exists && adminRoleDoc.data()?.userId === callerId) ||
        (Array.isArray(caller.realTemplateProjectIds) && caller.realTemplateProjectIds.includes(projectId))

    // The creator unlocks for the goal's owner when the owner is a member; otherwise for themselves.
    const ownerId = typeof goal.ownerId === 'string' ? goal.ownerId : ''
    const targetId = isCreator && ownerId && memberIds.includes(ownerId) ? ownerId : callerId

    const callerRef = db.doc(`users/${callerId}`)
    const targetRef = db.doc(`users/${targetId}`)
    let result

    await db.runTransaction(async transaction => {
        const freshCaller = await transaction.get(callerRef)
        const freshTarget = targetId === callerId ? freshCaller : await transaction.get(targetRef)
        if (!freshCaller.exists || !freshTarget.exists) {
            result = { success: false, message: 'User not found' }
            return
        }
        if (hasLockKey(freshTarget.data(), projectId, lockKey)) {
            result = { success: true, alreadyUnlocked: true }
            return
        }

        const keyUpdate = { unlockedKeysByGuides: { [projectId]: FieldValue.arrayUnion(lockKey) } }
        result = applyGoldChangeInTransaction({
            transaction,
            userRef: callerRef,
            userData: freshCaller.data() || {},
            delta: -GOAL_UNLOCK_GOLD,
            direction: 'spend',
            source: 'goal_unlock',
            context: { projectId, goalId, objectId: goalId, objectType: 'goals', channel: 'guides' },
            requireSufficientBalance: true,
            additionalUserFields: targetId === callerId ? keyUpdate : {},
        })
        if (result.success && targetId !== callerId) transaction.set(targetRef, keyUpdate, { merge: true })
    })

    return { ...result, unlockedFor: targetId, lockKey: result?.success ? lockKey : undefined }
}

module.exports = { unlockGuideGoal, UnlockGoalError, GOAL_UNLOCK_GOLD }
