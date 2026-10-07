const { canAccessObject, getObjectDocPath } = require('../shared/privacyAccess')

const ACTIVE_STATUSES = ['queued', 'pending', 'initiated', 'awaiting_user', 'cancel_requested']
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)

// Discover the viewer's jobs without exposing server-only VM documents or sandbox credentials.
// Progress stays in the existing, independently permission-checked task/chat comment listener.
async function listActiveVmJobs({ db, userId, selectedRunId }) {
    if (!validId(userId)) throw new Error('Authentication required')
    const snapshot = await db
        .collection('pendingWebhooks')
        .where('userId', '==', userId)
        .where('kind', '==', 'vm_job')
        .where('status', 'in', ACTIVE_STATUSES)
        .limit(100)
        .get()
    const records = [...snapshot.docs]
    // Keep the selected result visible after completion, including on a later refresh.
    if (validId(selectedRunId) && !records.some(doc => doc.id === selectedRunId)) {
        const selected = await db.doc(`pendingWebhooks/${selectedRunId}`).get()
        if (selected.exists) records.push(selected)
    }
    const candidates = records
        .map(doc => ({ ...doc.data(), id: doc.id }))
        .filter(
            job =>
                job.kind === 'vm_job' &&
                job.userId === userId &&
                validId(job.projectId) &&
                validId(job.objectId) &&
                ['tasks', 'topics'].includes(job.objectType) &&
                (ACTIVE_STATUSES.includes(job.status) || job.id === selectedRunId)
        )
    const paths = [
        ...new Set(
            candidates.flatMap(job => [
                `projects/${job.projectId}`,
                getObjectDocPath(job.projectId, job.objectType, job.objectId),
            ])
        ),
    ]
    const docs = paths.length ? await db.getAll(...paths.map(path => db.doc(path))) : []
    const byPath = new Map(paths.map((path, index) => [path, docs[index].data()]))
    const jobs = []
    for (const job of candidates) {
        const project = byPath.get(`projects/${job.projectId}`)
        const object = byPath.get(getObjectDocPath(job.projectId, job.objectType, job.objectId))
        if (
            !project?.userIds?.includes(userId) ||
            !canAccessObject(object, userId) ||
            (object.annaOwnerId && object.annaOwnerId !== userId)
        )
            continue
        jobs.push({
            id: job.id,
            projectId: job.projectId,
            objectId: job.objectId,
            objectType: job.objectType,
            title: String(object.name || object.title || 'VM').slice(0, 200),
            projectName: String(project.name || '').slice(0, 100),
            model: typeof job.agentModel === 'string' ? job.agentModel.slice(0, 100) : '',
            status: job.status,
            commentId: validId(job.statusCommentId) ? job.statusCommentId : null,
            createdAt: Number(job.createdAt) || 0,
        })
    }
    jobs.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    return { jobs }
}

module.exports = { listActiveVmJobs }
