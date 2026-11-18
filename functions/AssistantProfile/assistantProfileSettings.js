'use strict'

// The callables behind the profile section of Settings → Profile. The tree is server-written only
// (firestore.rules), so these are the one way a browser changes it, and each acts on the caller's own
// profile only: the user id is request.auth.uid, never anything the request names.

const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

const {
    ASSISTANT_PROFILE_ENABLED_BY_DEFAULT,
    ASSISTANT_PROFILE_ENABLED_BY_USER,
    ASSISTANT_PROFILE_REFRESH_COOLDOWN_MS,
    AssistantProfileSettingsError,
    DEFAULT_ASSISTANT_PROFILE_MODEL,
    DEFAULT_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP,
    getAssistantProfileMonthlyGoldSpent,
    getAssistantProfilePath,
    getAssistantProfileRevisionId,
    getAssistantProfileRevisionsPath,
    isAssistantProfilePausedAtMonthlyCap,
    isAssistantProfilePausedForInactiveOwner,
    normalizeAssistantProfileSettingsInput,
    resolveAssistantProfileModel,
    resolveAssistantProfileMonthlyGoldCap,
    resolveAssistantProfileSources,
    toAssistantProfileSettingsView,
} = require('./assistantProfileModel')
const { nextAssistantProfileRunAt } = require('./assistantProfileSchedule')
const { writeAssistantProfileText } = require('./assistantProfileStore')

function defaultEnqueue(args) {
    const { enqueueAssistantProfileRun } = require('./assistantProfileDispatcher')
    return enqueueAssistantProfileRun(args)
}

// The scheduler picks every due run up within 15 minutes anyway; this only saves that wait.
async function enqueueSoon(enqueue, userId, dueAt, trigger) {
    try {
        await enqueue({ userId, dueAt, trigger })
    } catch (error) {
        console.warn('[assistant profile] Could not enqueue an immediate run; the scheduler will pick it up', {
            userId,
            trigger,
            error: error.message,
        })
    }
}

function requireUser(userId) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
}

async function readUserData(db, userId) {
    const snapshot = await db.doc(`users/${userId}`).get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'User not found.')
    return snapshot.data() || {}
}

async function getAssistantProfileSettings({ userId, db = admin.firestore(), now = Date.now() }) {
    requireUser(userId)
    const snapshot = await db.doc(getAssistantProfilePath(userId)).get()
    return toAssistantProfileSettingsView(userId, snapshot.exists ? snapshot.data() || {} : {}, now)
}

async function setAssistantProfileSettings({
    userId,
    settings,
    db = admin.firestore(),
    now = Date.now(),
    enqueue = defaultEnqueue,
}) {
    requireUser(userId)
    let patch
    try {
        patch = normalizeAssistantProfileSettingsInput(settings)
    } catch (error) {
        if (error instanceof AssistantProfileSettingsError) throw new HttpsError('invalid-argument', error.message)
        throw error
    }
    const userData = await readUserData(db, userId)
    const ref = db.doc(getAssistantProfilePath(userId))
    const { text, ...settingsPatch } = patch

    const outcome = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const current = snapshot.exists ? snapshot.data() || {} : null
        const wasEnabled = current?.enabled === true
        // A user the default has not reached yet sees the profile as on; their first save keeps it on.
        const enabled = settingsPatch.enabled !== undefined ? settingsPatch.enabled : current ? wasEnabled : true
        const next = {
            userId,
            enabled,
            instructions:
                settingsPatch.instructions !== undefined
                    ? settingsPatch.instructions
                    : typeof current?.instructions === 'string'
                      ? current.instructions
                      : '',
            model:
                settingsPatch.model || resolveAssistantProfileModel(current?.model || DEFAULT_ASSISTANT_PROFILE_MODEL),
            monthlyGoldCap:
                settingsPatch.monthlyGoldCap !== undefined
                    ? settingsPatch.monthlyGoldCap
                    : resolveAssistantProfileMonthlyGoldCap(
                          current?.monthlyGoldCap ?? DEFAULT_ASSISTANT_PROFILE_MONTHLY_GOLD_CAP
                      ),
            sources: { ...resolveAssistantProfileSources(current?.sources), ...(settingsPatch.sources || {}) },
            updatedAt: now,
        }
        if (!current) {
            next.createdAt = now
            next.revision = 0
            next.text = ''
        }

        let runNow = false
        if (settingsPatch.enabled !== undefined) {
            next.enabledBy = ASSISTANT_PROFILE_ENABLED_BY_USER
        } else if (!current) {
            next.enabledBy = ASSISTANT_PROFILE_ENABLED_BY_DEFAULT
        }
        if (enabled) {
            if (!wasEnabled) {
                next.enabledAt = now
                // Switching it on should not wait for the night; neither should a first save.
                next.nextRunAt = now
                runNow = true
            } else if (isAssistantProfilePausedForInactiveOwner(current)) {
                // Whoever saves is using Alldone right now.
                next.nextRunAt = nextAssistantProfileRunAt(now, userData)
                next.lastRunStopReason = null
            } else if (
                isAssistantProfilePausedAtMonthlyCap(current, now) &&
                next.monthlyGoldCap > getAssistantProfileMonthlyGoldSpent(current, now)
            ) {
                next.nextRunAt = now
                runNow = true
            }
        } else if (wasEnabled || !current) {
            next.disabledAt = now
            next.nextRunAt = null
        }

        transaction.set(ref, next, { merge: true })
        return { runNow, merged: { ...(current || {}), ...next } }
    })

    let merged = outcome.merged
    if (text !== undefined) {
        const result = await writeAssistantProfileText({ db, userId, text, mode: 'user', now })
        if (!result.success) throw new HttpsError('invalid-argument', result.error || 'The profile could not be saved.')
        if (!result.unchanged) merged = { ...merged, text, revision: result.revision, textUpdatedAt: now }
    }
    if (outcome.runNow) await enqueueSoon(enqueue, userId, now, 'enabled')
    return toAssistantProfileSettingsView(userId, merged, now)
}

// "Update now". The monthly cap still protects the user; a cooldown keeps a double click from
// queueing a run per press.
async function requestAssistantProfileRefresh({
    userId,
    db = admin.firestore(),
    now = Date.now(),
    enqueue = defaultEnqueue,
}) {
    requireUser(userId)
    const ref = db.doc(getAssistantProfilePath(userId))
    const result = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref)
        const current = snapshot.exists ? snapshot.data() || {} : null
        if (!current || current.enabled !== true) {
            throw new HttpsError('failed-precondition', 'Switch the assistant profile on before updating it.')
        }
        const lastRequestedAt = Number(current.refreshRequestedAt)
        if (Number.isFinite(lastRequestedAt) && now - lastRequestedAt < ASSISTANT_PROFILE_REFRESH_COOLDOWN_MS) {
            return { alreadyRequested: true, nextRunAt: Number.isFinite(current.nextRunAt) ? current.nextRunAt : now }
        }
        transaction.update(ref, { refreshRequestedAt: now, nextRunAt: now, lastRunStopReason: null })
        return { alreadyRequested: false, nextRunAt: now }
    })
    if (!result.alreadyRequested) await enqueueSoon(enqueue, userId, now, 'refresh')
    return { success: true, ...result }
}

// Puts an older version back. It becomes a new revision of its own, so the restore can be undone
// the same way.
async function restoreAssistantProfileRevision({ userId, revision, db = admin.firestore(), now = Date.now() }) {
    requireUser(userId)
    const revisionNumber = Number(revision)
    if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
        throw new HttpsError('invalid-argument', 'A revision number is required.')
    }
    const snapshot = await db
        .doc(`${getAssistantProfileRevisionsPath(userId)}/${getAssistantProfileRevisionId(revisionNumber)}`)
        .get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'That version of the profile does not exist.')
    const stored = snapshot.data() || {}
    const result = await writeAssistantProfileText({
        db,
        userId,
        text: typeof stored.text === 'string' ? stored.text : '',
        mode: 'restore',
        summary: `Restored version ${revisionNumber}`,
        restoredFromRevision: revisionNumber,
        now,
    })
    if (!result.success)
        throw new HttpsError('failed-precondition', result.error || 'The version could not be restored.')
    return { success: true, revision: result.revision, unchanged: !!result.unchanged }
}

module.exports = {
    getAssistantProfileSettings,
    setAssistantProfileSettings,
    requestAssistantProfileRefresh,
    restoreAssistantProfileRevision,
}
