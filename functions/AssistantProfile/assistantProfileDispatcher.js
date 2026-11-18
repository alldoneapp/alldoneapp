'use strict'

// Hands due profile runs to the runAssistantProfileUpdate Cloud Tasks worker, the way the wiki's
// dispatcher does (KnowledgeBase/knowledgeBaseDispatcher.js):
//   - dispatchDueAssistantProfileRuns, every 15 minutes: every profile whose nextRunAt has passed.
//     A disabled or paused profile has nextRunAt null, so the single-field range query never returns
//     it and needs no composite index;
//   - enqueueAssistantProfileRun directly, for "update now", switching it on and a transient retry.
// The task id is derived from (user, nextRunAt): a run still queued is not queued twice, and a new
// nextRunAt is a new task.

const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')

const { ASSISTANT_PROFILES_COLLECTION } = require('./assistantProfileModel')

const REGION = 'europe-west1'
const ASSISTANT_PROFILE_WORKER_FUNCTION_NAME = 'runAssistantProfileUpdate'
const DISPATCH_PAGE_SIZE = 200

function getAssistantProfileWorkerQueueResource() {
    const projectId =
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        (() => {
            try {
                return admin.app().options.projectId
            } catch (_) {
                return undefined
            }
        })()
    return projectId
        ? `locations/${REGION}/functions/${ASSISTANT_PROFILE_WORKER_FUNCTION_NAME}`
        : ASSISTANT_PROFILE_WORKER_FUNCTION_NAME
}

function isTaskAlreadyExistsError(error) {
    return ['functions/task-already-exists', 'already-exists', 6].includes(error?.code)
}

function getAssistantProfileTaskId(userId, dueAt) {
    return `ap-${String(userId).replace(/[^A-Za-z0-9_-]/g, '_')}-${Math.round(Number(dueAt) || 0)}`
}

async function enqueueAssistantProfileRun({ userId, dueAt, trigger = 'scheduled', queue = null }) {
    const taskQueue = queue || getFunctions().taskQueue(getAssistantProfileWorkerQueueResource())
    try {
        await taskQueue.enqueue(
            { userId, dueAt, trigger },
            {
                id: getAssistantProfileTaskId(userId, dueAt),
                scheduleTime: new Date(Math.max(Date.now(), Number(dueAt) || 0)),
                dispatchDeadlineSeconds: 1800,
            }
        )
        return 'enqueued'
    } catch (error) {
        if (isTaskAlreadyExistsError(error)) return 'duplicate'
        throw error
    }
}

async function dispatchDueAssistantProfileRuns({ db = admin.firestore(), queue = null, now = Date.now() } = {}) {
    const stats = { due: 0, enqueued: 0, duplicate: 0, busy: 0, disabled: 0, failed: 0 }
    const snapshot = await db
        .collection(ASSISTANT_PROFILES_COLLECTION)
        .where('nextRunAt', '<=', now)
        .orderBy('nextRunAt', 'asc')
        .limit(DISPATCH_PAGE_SIZE)
        .get()

    for (const doc of snapshot.docs) {
        const profile = doc.data() || {}
        stats.due += 1
        if (profile.enabled !== true) {
            stats.disabled += 1
            continue
        }
        if (profile.leaseOwner && Number(profile.leaseExpiresAt) > now) {
            stats.busy += 1
            continue
        }
        try {
            const result = await enqueueAssistantProfileRun({ userId: doc.id, dueAt: profile.nextRunAt, queue })
            stats[result] += 1
        } catch (error) {
            stats.failed += 1
            console.error('[assistant profile] Could not enqueue a run', {
                userId: doc.id,
                error: error.message,
                code: error.code || null,
            })
        }
    }

    console.log('[assistant profile] Dispatcher completed', {
        ...stats,
        capped: snapshot.docs.length >= DISPATCH_PAGE_SIZE,
    })
    return stats
}

module.exports = {
    ASSISTANT_PROFILE_WORKER_FUNCTION_NAME,
    getAssistantProfileWorkerQueueResource,
    getAssistantProfileTaskId,
    enqueueAssistantProfileRun,
    dispatchDueAssistantProfileRuns,
}
