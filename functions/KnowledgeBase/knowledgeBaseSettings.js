'use strict'

const admin = require('firebase-admin')
const { HttpsError } = require('firebase-functions/v2/https')

const {
    KNOWLEDGE_BASE_ENABLED_BY_MEMBER,
    KNOWLEDGE_BASE_REFRESH_COOLDOWN_MS,
    KnowledgeBaseSettingsError,
    getKnowledgeBaseMonthlyGoldSpent,
    getKnowledgeBasePath,
    isKnowledgeBasePausedAtMonthlyCap,
    isKnowledgeBasePausedForInactiveOwner,
    normalizeKnowledgeBaseSettingsInput,
    resolveKnowledgeBaseModel,
    resolveKnowledgeBaseMonthlyGoldCap,
    toKnowledgeBaseSettingsView,
} = require('./knowledgeBaseModel')

async function assertProjectMember(db, projectId, userId) {
    const snapshot = await db.doc(`projects/${projectId}`).get()
    if (!snapshot.exists) throw new HttpsError('not-found', 'Project not found.')
    const project = snapshot.data() || {}
    const userIds = Array.isArray(project.userIds) ? project.userIds : []
    if (!userIds.includes(userId)) {
        throw new HttpsError('permission-denied', 'You are not a member of this project.')
    }
    return project
}

function validateCaller(userId, projectId) {
    if (!userId) throw new HttpsError('unauthenticated', 'Authentication required.')
    if (!projectId || typeof projectId !== 'string') {
        throw new HttpsError('invalid-argument', 'A projectId is required.')
    }
}

// The member who switches the wiki on pays for its runs, so while it is on only they may change
// how much it may spend or which model it runs. Anyone may take it over once that member has left
// the project, otherwise a departed owner would leave a wiki nobody can configure or switch off.
function canManageKnowledgeBase(current, userId, projectUserIds) {
    if (!current || current.enabled !== true) return true
    if (!current.ownerUserId || current.ownerUserId === userId) return true
    return !projectUserIds.includes(current.ownerUserId)
}

// The scheduler picks every due run up within 15 minutes anyway; this only saves that wait, so a
// failure to enqueue is logged and swallowed rather than failing a save that already happened.
async function enqueueSoon(enqueue, projectId, dueAt, trigger) {
    try {
        await enqueue({ projectId, dueAt, trigger })
    } catch (error) {
        console.warn('[knowledge base] Could not enqueue an immediate run; the scheduler will pick it up', {
            projectId,
            trigger,
            error: error.message,
        })
    }
}

function defaultEnqueue(args) {
    const { enqueueKnowledgeBaseIngest } = require('./knowledgeBaseDispatcher')
    return enqueueKnowledgeBaseIngest(args)
}

async function setKnowledgeBaseSettings({
    userId,
    projectId,
    settings,
    db = admin.firestore(),
    now = Date.now(),
    enqueue = defaultEnqueue,
}) {
    validateCaller(userId, projectId)

    let patch
    try {
        patch = normalizeKnowledgeBaseSettingsInput(settings)
    } catch (error) {
        if (error instanceof KnowledgeBaseSettingsError) throw new HttpsError('invalid-argument', error.message)
        throw error
    }

    const project = await assertProjectMember(db, projectId, userId)
    const projectUserIds = Array.isArray(project.userIds) ? project.userIds : []
    const knowledgeBaseRef = db.doc(getKnowledgeBasePath(projectId))

    const view = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(knowledgeBaseRef)
        const current = snapshot.exists ? snapshot.data() || {} : null

        if (!canManageKnowledgeBase(current, userId, projectUserIds)) {
            throw new HttpsError(
                'permission-denied',
                'Only the member who switched the project wiki on can change its settings while it is on.'
            )
        }

        const wasEnabled = current?.enabled === true
        const enabled = patch.enabled !== undefined ? patch.enabled : wasEnabled
        const next = {
            projectId,
            enabled,
            instructions:
                patch.instructions !== undefined
                    ? patch.instructions
                    : typeof current?.instructions === 'string'
                      ? current.instructions
                      : '',
            model: patch.model || resolveKnowledgeBaseModel(current?.model),
            monthlyGoldCap:
                patch.monthlyGoldCap !== undefined
                    ? patch.monthlyGoldCap
                    : resolveKnowledgeBaseMonthlyGoldCap(current?.monthlyGoldCap),
            updatedAt: now,
            updatedBy: userId,
        }

        if (!current) next.createdAt = now

        let resumedFromCap = false
        if (enabled) {
            // Switching it on, or taking over from a departed owner, makes the caller the payer, by
            // their own choice: the default switch-on no longer hands this wiki to somebody else.
            if (!wasEnabled || current?.ownerUserId !== userId) {
                next.ownerUserId = userId
                next.enabledBy = KNOWLEDGE_BASE_ENABLED_BY_MEMBER
            }
            if (!wasEnabled) {
                next.enabledAt = now
                // The first build should not wait for the nightly slot.
                next.nextRunAt = now
            } else if (isKnowledgeBasePausedForInactiveOwner(current)) {
                // Whoever saves is using Alldone right now, and is (or just became) the payer.
                next.nextRunAt = now
            } else if (
                isKnowledgeBasePausedAtMonthlyCap(current, now) &&
                next.monthlyGoldCap > getKnowledgeBaseMonthlyGoldSpent(current, now)
            ) {
                // The cap notice (knowledgeBaseCapNotice.js) sends the payer here to raise the cap.
                // Raising it has to end the pause now, not on the first of next month.
                next.nextRunAt = now
                resumedFromCap = true
            }
        } else if (wasEnabled) {
            next.disabledAt = now
            next.nextRunAt = null
        }

        transaction.set(knowledgeBaseRef, next, { merge: true })
        return {
            ...toKnowledgeBaseSettingsView(projectId, { ...(current || {}), ...next }, now),
            justEnabled: enabled && !wasEnabled,
            resumedFromCap,
        }
    })

    const { justEnabled, resumedFromCap, ...settingsView } = view
    if (justEnabled) await enqueueSoon(enqueue, projectId, now, 'enabled')
    else if (resumedFromCap) await enqueueSoon(enqueue, projectId, now, 'cap_raised')
    return settingsView
}

// Asks for a run as soon as the scheduler next looks. Any member may ask (the wiki is theirs as
// much as the owner's, and the monthly cap protects the payer); a cooldown keeps a double click or
// an impatient retry from queueing a run per press.
async function requestKnowledgeBaseRefresh({
    userId,
    projectId,
    db = admin.firestore(),
    now = Date.now(),
    enqueue = defaultEnqueue,
}) {
    validateCaller(userId, projectId)
    await assertProjectMember(db, projectId, userId)
    const knowledgeBaseRef = db.doc(getKnowledgeBasePath(projectId))

    const result = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(knowledgeBaseRef)
        const current = snapshot.exists ? snapshot.data() || {} : null
        if (!current || current.enabled !== true) {
            throw new HttpsError('failed-precondition', 'Switch the project wiki on before refreshing it.')
        }

        const lastRequestedAt = Number(current.refreshRequestedAt)
        if (Number.isFinite(lastRequestedAt) && now - lastRequestedAt < KNOWLEDGE_BASE_REFRESH_COOLDOWN_MS) {
            return {
                success: true,
                alreadyRequested: true,
                nextRunAt: Number.isFinite(current.nextRunAt) ? current.nextRunAt : lastRequestedAt,
            }
        }

        transaction.update(knowledgeBaseRef, {
            refreshRequestedAt: now,
            refreshRequestedBy: userId,
            nextRunAt: now,
        })
        return { success: true, alreadyRequested: false, nextRunAt: now }
    })

    if (!result.alreadyRequested) await enqueueSoon(enqueue, projectId, now, 'manual')
    return result
}

module.exports = {
    canManageKnowledgeBase,
    setKnowledgeBaseSettings,
    requestKnowledgeBaseRefresh,
}
