const { canAccessObject, getObjectDocPath } = require('../shared/privacyAccess')

const ACTIVE_STATUSES = ['queued', 'pending', 'initiated', 'awaiting_user', 'cancel_requested']
// A thread with several live jobs is represented by the one actually holding it; queued follow-ups
// are only counted. An orphaned cancel (AT-2916) loses to the live run on the same thread.
const REPRESENTATIVE_PRIORITY = { awaiting_user: 0, initiated: 1, pending: 2, cancel_requested: 3, queued: 4 }
// Same rule as the task list's VM badge (utils/backends/Assistants/vmSessionStatusHelper.js): an idle
// or paused sandbox whose last run did not fail is "paused". Failed sessions have no VM to go back to.
const PAUSED_SESSION_STATUSES = ['paused', 'idle_running']
const FAILED_LAST_RUN_STATUSES = ['failed', 'interrupted']
const MAX_SESSIONS = 50
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const threadKey = (projectId, objectId) => `${projectId}__${objectId}`

function isListedPausedSession(session, userId) {
    return (
        session.lastRequestUserId === userId &&
        session.taskDone === false &&
        session.objectType === 'tasks' &&
        validId(session.projectId) &&
        validId(session.objectId) &&
        PAUSED_SESSION_STATUSES.includes(session.status) &&
        !FAILED_LAST_RUN_STATUSES.includes(session.lastRunStatus)
    )
}

// The paused half of the overview must never take the running VMs down with it: if the session
// query is refused (e.g. an index Firestore will not merge), the overview degrades to active runs.
async function loadPausedSessions(db, userId) {
    try {
        const snapshot = await db
            .collection('vmSessions')
            .where('lastRequestUserId', '==', userId)
            .where('taskDone', '==', false)
            .limit(MAX_SESSIONS)
            .get()
        return snapshot.docs.map(doc => doc.data() || {}).filter(session => isListedPausedSession(session, userId))
    } catch (error) {
        console.warn('🖥️ VM workspace: paused sessions unavailable', { error: error.message })
        return []
    }
}

function compareRepresentatives(a, b) {
    return (
        (REPRESENTATIVE_PRIORITY[a.status] ?? 9) - (REPRESENTATIVE_PRIORITY[b.status] ?? 9) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id)
    )
}

// Discover the viewer's jobs without exposing server-only VM documents or sandbox credentials.
// Progress stays in the existing, independently permission-checked task/chat comment listener.
//
// `jobs` lists every live run (the pre-AT-2916 contract, kept for older clients). `threads` is what
// the overview shows since AT-2916: one entry per task/topic thread, like the task list's VM badge,
// plus the user's PAUSED VMs on open tasks, so the overview and the Workflows view agree.
async function listActiveVmJobs({ db, userId, selectedRunId }) {
    if (!validId(userId)) throw new Error('Authentication required')
    const [snapshot, pausedSessions] = await Promise.all([
        db
            .collection('pendingWebhooks')
            .where('userId', '==', userId)
            .where('kind', '==', 'vm_job')
            .where('status', 'in', ACTIVE_STATUSES)
            .limit(100)
            .get(),
        loadPausedSessions(db, userId),
    ])
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
    const liveThreads = new Set(
        candidates
            .filter(job => ACTIVE_STATUSES.includes(job.status))
            .map(job => threadKey(job.projectId, job.objectId))
    )
    const paused = pausedSessions.filter(session => !liveThreads.has(threadKey(session.projectId, session.objectId)))
    const lastRunIds = [...new Set(paused.map(session => session.lastRunCorrelationId).filter(validId))]

    const paths = [
        ...new Set([
            ...candidates.flatMap(job => [
                `projects/${job.projectId}`,
                getObjectDocPath(job.projectId, job.objectType, job.objectId),
            ]),
            ...paused.flatMap(session => [
                `projects/${session.projectId}`,
                getObjectDocPath(session.projectId, 'tasks', session.objectId),
            ]),
            ...lastRunIds.map(id => `pendingWebhooks/${id}`),
        ]),
    ]
    const docs = paths.length ? await db.getAll(...paths.map(path => db.doc(path))) : []
    const byPath = new Map(paths.map((path, index) => [path, docs[index].data()]))
    const describe = (projectId, objectType, objectId) => {
        const project = byPath.get(`projects/${projectId}`)
        const object = byPath.get(getObjectDocPath(projectId, objectType, objectId))
        if (
            !project?.userIds?.includes(userId) ||
            !canAccessObject(object, userId) ||
            (object.annaOwnerId && object.annaOwnerId !== userId)
        )
            return null
        return {
            object,
            projectId,
            objectId,
            objectType,
            title: String(object.name || object.title || 'VM').slice(0, 200),
            projectName: String(project.name || '').slice(0, 100),
        }
    }
    const jobs = []
    for (const job of candidates) {
        const place = describe(job.projectId, job.objectType, job.objectId)
        if (!place) continue
        const { object, ...where } = place
        jobs.push({
            id: job.id,
            ...where,
            model: typeof job.agentModel === 'string' ? job.agentModel.slice(0, 100) : '',
            status: job.status,
            commentId: validId(job.statusCommentId) ? job.statusCommentId : null,
            createdAt: Number(job.createdAt) || 0,
        })
    }
    jobs.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

    const byThread = new Map()
    for (const job of jobs) {
        const key = threadKey(job.projectId, job.objectId)
        byThread.set(key, [...(byThread.get(key) || []), job])
    }
    const threads = []
    for (const [key, threadJobs] of byThread) {
        const live = threadJobs.filter(job => ACTIVE_STATUSES.includes(job.status))
        // A settled selected run only stands for its thread while nothing else does.
        if (!live.length && paused.some(session => threadKey(session.projectId, session.objectId) === key)) continue
        const representative = [...(live.length ? live : threadJobs)].sort(compareRepresentatives)[0]
        const { id: runId, ...rest } = representative
        threads.push({
            ...rest,
            id: key,
            runId,
            waitingCount: live.filter(job => job !== representative && job.status === 'queued').length,
        })
    }
    for (const session of paused) {
        const place = describe(session.projectId, 'tasks', session.objectId)
        // The mirrored flag can lag (or predate a reopen); the task itself decides.
        if (!place || place.object.done === true) continue
        const { object, ...where } = place
        const lastRun = byPath.get(`pendingWebhooks/${session.lastRunCorrelationId}`)
        const lastRunMatches =
            lastRun?.kind === 'vm_job' &&
            lastRun.projectId === session.projectId &&
            lastRun.objectId === session.objectId
        threads.push({
            ...where,
            id: threadKey(session.projectId, session.objectId),
            runId: lastRunMatches ? session.lastRunCorrelationId : null,
            model: lastRunMatches && typeof lastRun.agentModel === 'string' ? lastRun.agentModel.slice(0, 100) : '',
            status: 'paused',
            commentId: lastRunMatches && validId(lastRun.statusCommentId) ? lastRun.statusCommentId : null,
            createdAt: Number(session.lastUsedAt) || Number(session.lastRunAt) || 0,
            waitingCount: 0,
        })
    }
    // Running VMs first, oldest first (their order does not jump while they run); then the paused
    // and settled ones, most recently used first.
    const isLive = thread => ACTIVE_STATUSES.includes(thread.status)
    threads.sort(
        (a, b) =>
            isLive(b) - isLive(a) ||
            (isLive(a) ? a.createdAt - b.createdAt : b.createdAt - a.createdAt) ||
            a.id.localeCompare(b.id)
    )
    return { jobs, threads }
}

module.exports = { listActiveVmJobs }
