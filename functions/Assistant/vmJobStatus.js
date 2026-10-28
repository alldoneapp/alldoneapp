'use strict'

const { assertObjectAccess } = require('../shared/privacyAccess')

const SETTLED_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const MAX_WAIT_SECONDS = 30

async function getVmJobStatus({
    db,
    userId,
    correlationId,
    waitSeconds = 0,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = Date.now,
}) {
    if (!userId || typeof correlationId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(correlationId)) {
        throw new Error('A valid VM correlationId and authenticated requesting user are required.')
    }
    const seconds = Number(waitSeconds)
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_WAIT_SECONDS) {
        throw new Error(`waitSeconds must be between 0 and ${MAX_WAIT_SECONDS}.`)
    }
    const ref = db.doc(`pendingWebhooks/${correlationId}`)
    const read = async () => {
        const snapshot = await ref.get()
        const job = snapshot.exists ? snapshot.data() : null
        if (!job || job.kind !== 'vm_job' || job.userId !== userId) throw new Error('VM job not found.')
        await assertObjectAccess(db, userId, job.projectId, job.objectType || 'tasks', job.objectId)
        return job
    }
    const deadline = now() + seconds * 1000
    let job = await read()
    while (!SETTLED_STATUSES.has(job.status) && job.status !== 'awaiting_user' && now() < deadline) {
        await sleep(Math.min(2000, deadline - now()))
        job = await read()
    }
    const result = {
        success: true,
        correlationId,
        hostProjectId: job.projectId,
        hostObjectId: job.objectId,
        hostObjectType: job.objectType || 'tasks',
        status: job.status,
        settled: SETTLED_STATUSES.has(job.status),
        artifacts: [],
        message:
            SETTLED_STATUSES.has(job.status) || job.status === 'awaiting_user'
                ? 'Use the result below. Do not restart this job.'
                : 'The existing job is still working. Call get_vm_job with waitSeconds=30 to wait again; do not start another VM job.',
    }
    if (job.statusCommentId) {
        const comment = await db
            .doc(
                `chatComments/${job.projectId}/${job.objectType || 'tasks'}/${job.objectId}/comments/${job.statusCommentId}`
            )
            .get()
        const data = comment.exists ? comment.data() : null
        if (data?.assistantRun?.runId === correlationId) result.output = String(data.commentText || '').slice(0, 12000)
    }
    if (job.status === 'completed') result.artifacts = job.resultArtifacts || []
    if (job.error) result.error = String(job.error).slice(0, 1000)
    return result
}

module.exports = { getVmJobStatus }
