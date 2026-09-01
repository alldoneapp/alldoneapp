'use strict'

const admin = require('firebase-admin')

const { ACTIVE_USER_WINDOW_MS, getTimestampMillis } = require('../Assistant/assistantHeartbeatSchedule')
const { getUserLocalDateKey } = require('./calendarUserDay')

/**
 * AT-2480 - the once-a-day server-side calendar pull.
 *
 * A meeting only becomes an Alldone task once `syncCalendarEvents` has run for the user's local
 * day, and until this landed the ONLY thing that ever called it was a browser
 * (`checkIfCalendarConnected`). So a day nobody opened the app on had no meetings at all, and
 * anything that reads the task list without a client in front of it - heartbeats, push, the
 * WhatsApp bridge, the assistant's own view of "what is on today" - saw an empty calendar.
 *
 * Three rules shape this, and all three are about spending nothing on people who are not there:
 *
 * 1. ACTIVE USERS ONLY, using the heartbeat definition. `ACTIVE_USER_WINDOW_MS` and
 *    `getTimestampMillis` are imported from `assistantHeartbeatSchedule` rather than re-declared,
 *    so "recently active" cannot drift away from what heartbeats mean by it. (Two other places
 *    in `functions/` still carry their own 30-day copy - `autoArchiveProjectsCloud` and
 *    `assistantRecurringTasks` - which is exactly the drift being avoided here.) This is what
 *    keeps the scan trivial: production holds 4381 user documents and the query returns 11.
 *
 * 2. ONCE PER USER PER LOCAL DAY, not once per scheduler tick. The scheduler runs hourly because
 *    "the day" is the USER's day: a single fixed UTC hour would fire before local midnight for
 *    everyone west of it and sync the WRONG day, then not fire again until the next tick. The
 *    hourly tick asks each user whether their own local date has moved past the one recorded in
 *    `users/{uid}/private/calendarScheduledSync`, so every user gets exactly one sync per local
 *    day, shortly after their own midnight. The marker is per PROJECT because a user can have
 *    several connected calendars.
 *
 * 3. NEVER MORE THAN ONCE. The marker is written whether the sync succeeded or failed
 *    (`markSyncAttempted`), so a permanently broken connection - a revoked Google token is the
 *    common one - costs one failed attempt a day instead of one an hour. The client-side pull
 *    still runs on every board mount and is what recovers a user the moment they reconnect.
 *
 * Deliberately NOT here: any notion of "sync more often during the day". Keeping a calendar warm
 * in real time is the client's job (`useTaskBoardCalendarSync`), and per-event LLM project
 * routing makes each run cost real Gold-side money - a 7-event day took 32s and ~21 Gold of
 * classification. This job exists so the day STARTS correct, not so it stays live.
 *
 * The marker lives under `users/{uid}/private/…`, which the existing
 * `users/{userId}/{userSubcollection}/{document=**}` rule makes owner-writable - so no rules
 * change, and no new collection or index. The worst an owner can do by writing a future date
 * there is switch off their OWN scheduled sync, which the client-side pull still covers.
 */

const SCHEDULED_SYNC_STATE_DOC = 'calendarScheduledSync'
const MAX_USERS_PER_RUN = 200
const MAX_PROJECTS_PER_USER = 10

const getCalendarConnectedProjectIds = (userData = {}) =>
    Object.entries(userData.apisConnected || {})
        .filter(([projectId, apis]) => !!projectId && !!apis?.calendar)
        .map(([projectId]) => projectId)
        .sort()

const isUserRecentlyActive = (userData = {}, now = Date.now()) =>
    getTimestampMillis(userData.lastLogin) >= now - ACTIVE_USER_WINDOW_MS

const getSyncStateRef = (userId, db) =>
    db.collection('users').doc(userId).collection('private').doc(SCHEDULED_SYNC_STATE_DOC)

/**
 * Which of the user's connected calendars still owe a sync for the local day they are in now.
 * An unknown/absent marker means "never synced", which is the cold-start case and must sync.
 */
const getProjectIdsDueForSync = (projectIds, syncState, localDateKey) =>
    projectIds.filter(projectId => syncState?.lastSyncedLocalDateByProject?.[projectId] !== localDateKey)

async function readSyncState(userId, db) {
    try {
        const doc = await getSyncStateRef(userId, db).get()
        return doc.exists ? doc.data() || {} : {}
    } catch (error) {
        // A state read that fails must not skip the sync - it would look exactly like "already
        // done today" and silently disable the job for that user.
        console.error('[scheduledCalendarSync] Could not read sync state', { userId, error: error.message })
        return {}
    }
}

async function markSyncAttempted({ userId, projectId, localDateKey, now, db }) {
    try {
        await getSyncStateRef(userId, db).set(
            {
                lastSyncedLocalDateByProject: { [projectId]: localDateKey },
                updatedAt: now,
            },
            { merge: true }
        )
        return true
    } catch (error) {
        console.error('[scheduledCalendarSync] Could not record sync state', {
            userId,
            projectId,
            error: error.message,
        })
        return false
    }
}

async function syncUserCalendars({ userId, userData, now, db, syncCalendarEvents }) {
    const projectIds = getCalendarConnectedProjectIds(userData)
    if (projectIds.length === 0) return { skipped: true, reason: 'no_calendar_connected' }

    const localDateKey = getUserLocalDateKey(userData, now)
    const syncState = await readSyncState(userId, db)
    const dueProjectIds = getProjectIdsDueForSync(projectIds, syncState, localDateKey).slice(0, MAX_PROJECTS_PER_USER)

    if (dueProjectIds.length === 0) return { skipped: true, reason: 'already_synced_today' }

    let syncedProjects = 0
    let failedProjects = 0

    for (const projectId of dueProjectIds) {
        // Recorded BEFORE the sync result is known and regardless of it: a connection that throws
        // every time (revoked token) must cost one attempt a day, not one an hour.
        await markSyncAttempted({ userId, projectId, localDateKey, now, db })

        try {
            await syncCalendarEvents(userId, projectId)
            syncedProjects++
        } catch (error) {
            failedProjects++
            console.error('[scheduledCalendarSync] Calendar sync failed', {
                userId,
                projectId,
                error: error.message,
            })
        }
    }

    return { skipped: false, localDateKey, syncedProjects, failedProjects }
}

async function syncCalendarsForActiveUsers({
    now = Date.now(),
    db = admin.firestore(),
    limit = MAX_USERS_PER_RUN,
    // Injected so the batch loop can be tested without the Google/Microsoft transports.
    syncCalendarEvents = require('./serverSideCalendarSync').syncCalendarEvents,
} = {}) {
    const snapshot = await db
        .collection('users')
        .where('lastLogin', '>=', now - ACTIVE_USER_WINDOW_MS)
        .limit(limit)
        .get()

    let processedUsers = 0
    let skippedUsers = 0
    let syncedProjects = 0
    let failedProjects = 0

    for (const doc of snapshot.docs) {
        const userData = doc.data() || {}

        try {
            // The query already filtered on `lastLogin`, but a stored `Timestamp` sorts apart
            // from a stored number in Firestore, so re-check with the heartbeat coercion.
            if (!isUserRecentlyActive(userData, now)) {
                skippedUsers++
                continue
            }

            const result = await syncUserCalendars({ userId: doc.id, userData, now, db, syncCalendarEvents })
            if (result.skipped) {
                skippedUsers++
            } else {
                processedUsers++
                syncedProjects += result.syncedProjects
                failedProjects += result.failedProjects
            }
        } catch (error) {
            skippedUsers++
            console.error('[scheduledCalendarSync] Failed to process user', { userId: doc.id, error: error.message })
        }
    }

    console.log('[scheduledCalendarSync] Completed run', {
        activeUsers: snapshot.docs.length,
        processedUsers,
        skippedUsers,
        syncedProjects,
        failedProjects,
    })

    return {
        success: true,
        activeUsers: snapshot.docs.length,
        processedUsers,
        skippedUsers,
        syncedProjects,
        failedProjects,
    }
}

module.exports = {
    SCHEDULED_SYNC_STATE_DOC,
    MAX_USERS_PER_RUN,
    MAX_PROJECTS_PER_USER,
    getCalendarConnectedProjectIds,
    isUserRecentlyActive,
    getProjectIdsDueForSync,
    syncUserCalendars,
    syncCalendarsForActiveUsers,
}
