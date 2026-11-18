'use strict'

// The assistant profile is on by default for every active user (AT-3072), like the project wiki.
// The default is a document, not a reading of a missing one: a user without assistantProfiles/{uid}
// has never decided, so they get one here, switched on (enabledBy 'default'), first run at their next
// 04:00. A document that exists is a decision and is left alone, with one exception that keeps the
// default working: a profile paused because its user stopped using Alldone (owner_inactive) is
// scheduled again once they are back. A profile the user switched off stays off.
//
// The first run starts from the global description the user wrote (assistantProfileRun.js), so a
// user who kept that description up to date by hand, or with the old recurring task, loses nothing.
//
// Two callers: the user trigger when somebody logs in after 30 days away (or for the first time),
// and the daily sweep over every active user, which is also what reaches the users who were active
// before the default existed.

const admin = require('firebase-admin')

const { ACTIVE_USER_WINDOW_MS } = require('../Assistant/assistantHeartbeatSchedule')
const {
    ASSISTANT_PROFILE_ENABLED_BY_DEFAULT,
    DEFAULT_ASSISTANT_PROFILE_MODEL,
    DEFAULT_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
    getAssistantProfilePath,
    isAssistantProfilePausedForInactiveOwner,
} = require('./assistantProfileModel')
const { isAssistantProfileOwnerActive, nextAssistantProfileRunAt } = require('./assistantProfileSchedule')

const MAX_USERS_PER_SWEEP = 2000

function buildDefaultAssistantProfile({ userId, userData, now }) {
    return {
        userId,
        enabled: true,
        enabledBy: ASSISTANT_PROFILE_ENABLED_BY_DEFAULT,
        text: '',
        revision: 0,
        instructions: '',
        model: DEFAULT_ASSISTANT_PROFILE_MODEL,
        monthlyGoldCap: DEFAULT_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
        createdAt: now,
        enabledAt: now,
        updatedAt: now,
        nextRunAt: nextAssistantProfileRunAt(now, userData),
    }
}

// 'enabled', 'resumed', or why nothing happened. Never throws.
async function applyAssistantProfileDefaultForUser({ db = admin.firestore(), userId, userData, now = Date.now() }) {
    if (!userId) return 'invalid'
    if (!isAssistantProfileOwnerActive(userData, now)) return 'inactive'
    const ref = db.doc(getAssistantProfilePath(userId))
    try {
        return await db.runTransaction(async transaction => {
            const snapshot = await transaction.get(ref)
            if (!snapshot.exists) {
                transaction.create(ref, buildDefaultAssistantProfile({ userId, userData, now }))
                return 'enabled'
            }
            const current = snapshot.data() || {}
            if (isAssistantProfilePausedForInactiveOwner(current)) {
                transaction.update(ref, {
                    nextRunAt: nextAssistantProfileRunAt(now, userData),
                    lastRunStopReason: null,
                    updatedAt: now,
                })
                return 'resumed'
            }
            return 'exists'
        })
    } catch (error) {
        console.error('[assistant profile] Could not apply the default', { userId, error: error.message })
        return 'failed'
    }
}

async function applyAssistantProfileDefaultsForActiveUsers({
    db = admin.firestore(),
    now = Date.now(),
    limit = MAX_USERS_PER_SWEEP,
} = {}) {
    const snapshot = await db
        .collection('users')
        .where('lastLogin', '>=', now - ACTIVE_USER_WINDOW_MS)
        .limit(limit)
        .get()

    const stats = { activeUsers: 0 }
    for (const doc of snapshot.docs) {
        const userData = doc.data() || {}
        // The query filtered on lastLogin, but a stored Timestamp sorts apart from a stored number.
        if (!isAssistantProfileOwnerActive(userData, now)) continue
        stats.activeUsers += 1
        const result = await applyAssistantProfileDefaultForUser({ db, userId: doc.id, userData, now })
        stats[result] = (stats[result] || 0) + 1
    }

    console.log('[assistant profile] Default applied', { ...stats, capped: snapshot.docs.length >= limit })
    return stats
}

module.exports = {
    MAX_USERS_PER_SWEEP,
    buildDefaultAssistantProfile,
    applyAssistantProfileDefaultForUser,
    applyAssistantProfileDefaultsForActiveUsers,
}
