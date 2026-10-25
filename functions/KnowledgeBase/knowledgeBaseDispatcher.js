'use strict'

// Hands due wiki runs to the runKnowledgeBaseIngest Cloud Tasks worker. Two paths lead here:
//   - dispatchDueKnowledgeBaseIngests, every 15 minutes: every wiki whose nextRunAt has passed.
//     A disabled wiki has nextRunAt null, so the one single-field range query needs no composite
//     index and never returns it;
//   - enqueueKnowledgeBaseIngest directly, when a member presses "refresh now" or switches the wiki
//     on, so that does not wait for the next tick. Best effort: the tick is the backstop.
//
// The task id is derived from (project, nextRunAt), so a due run that is still queued is not queued
// twice by the next tick, and a new nextRunAt is a new task. A worker that dies without releasing
// its lease is retried once Cloud Tasks forgets the id (about an hour) and the lease has expired.

const admin = require('firebase-admin')
const { getFunctions } = require('firebase-admin/functions')

const { KNOWLEDGE_BASES_COLLECTION } = require('./knowledgeBaseModel')

const REGION = 'europe-west1'
const KNOWLEDGE_BASE_WORKER_FUNCTION_NAME = 'runKnowledgeBaseIngest'
const DISPATCH_PAGE_SIZE = 100

function getKnowledgeBaseWorkerQueueResource() {
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
        ? `locations/${REGION}/functions/${KNOWLEDGE_BASE_WORKER_FUNCTION_NAME}`
        : KNOWLEDGE_BASE_WORKER_FUNCTION_NAME
}

function isTaskAlreadyExistsError(error) {
    return ['functions/task-already-exists', 'already-exists', 6].includes(error?.code)
}

function getKnowledgeBaseTaskId(projectId, dueAt) {
    return `kb-${String(projectId).replace(/[^A-Za-z0-9_-]/g, '_')}-${Math.round(Number(dueAt) || 0)}`
}

async function enqueueKnowledgeBaseIngest({ projectId, dueAt, trigger = 'scheduled', queue = null }) {
    const taskQueue = queue || getFunctions().taskQueue(getKnowledgeBaseWorkerQueueResource())
    try {
        await taskQueue.enqueue(
            { projectId, dueAt, trigger },
            {
                id: getKnowledgeBaseTaskId(projectId, dueAt),
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

async function dispatchDueKnowledgeBaseIngests({ db = admin.firestore(), queue = null, now = Date.now() } = {}) {
    const stats = { due: 0, enqueued: 0, duplicate: 0, busy: 0, disabled: 0, failed: 0 }
    const snapshot = await db
        .collection(KNOWLEDGE_BASES_COLLECTION)
        .where('nextRunAt', '<=', now)
        .orderBy('nextRunAt', 'asc')
        .limit(DISPATCH_PAGE_SIZE)
        .get()

    for (const doc of snapshot.docs) {
        const knowledgeBase = doc.data() || {}
        stats.due += 1
        if (knowledgeBase.enabled !== true) {
            stats.disabled += 1
            continue
        }
        if (knowledgeBase.leaseOwner && Number(knowledgeBase.leaseExpiresAt) > now) {
            stats.busy += 1
            continue
        }
        try {
            const result = await enqueueKnowledgeBaseIngest({
                projectId: doc.id,
                dueAt: knowledgeBase.nextRunAt,
                trigger: knowledgeBase.rebuildRequestedAt >= knowledgeBase.nextRunAt ? 'rebuild' : 'scheduled',
                queue,
            })
            stats[result] += 1
        } catch (error) {
            stats.failed += 1
            console.error('[knowledge base] Could not enqueue an ingest run', {
                projectId: doc.id,
                error: error.message,
                code: error.code || null,
            })
        }
    }

    console.log('[knowledge base] Dispatcher completed', {
        ...stats,
        capped: snapshot.docs.length >= DISPATCH_PAGE_SIZE,
    })
    return stats
}

module.exports = {
    KNOWLEDGE_BASE_WORKER_FUNCTION_NAME,
    getKnowledgeBaseWorkerQueueResource,
    getKnowledgeBaseTaskId,
    enqueueKnowledgeBaseIngest,
    dispatchDueKnowledgeBaseIngests,
}
