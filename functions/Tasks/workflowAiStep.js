const admin = require('firebase-admin')
const { v4: uuidv4 } = require('uuid')

const {
    DONE_STEP,
    FEED_PUBLIC_FOR_ALL,
    STAYWARD_COMMENT,
    WORKSTREAM_ID_PREFIX,
} = require('../Utils/HelperFunctionsCloud')
const { getNextWorkflowStepId, isAiWorkflowStep, buildAiStepPrompt } = require('./workflowStepHelper')
const { ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS, TRANSPORT_HEADROOM_MS } = require('../Assistant/assistantRunLimits')
const { TARGET_MAX_VM_RUNTIME_MS, VM_JOB_FINALIZATION_HEADROOM_MS } = require('../Assistant/vmJobConfig')
const { acquireAssistantTaskRunLock, releaseAssistantTaskRunLock } = require('../Assistant/assistantRunIdempotency')

const RUNS_COLLECTION = 'workflowAiRuns'

// A claimed run occupies its slot for a whole assistant wall clock plus the work either side of it,
// so the lease has to outlast a healthy run or a second tick would start it again while it is still
// going.
const RUN_LEASE_MS = ASSISTANT_PROMPT_MAX_RUN_WALL_CLOCK_MS + TRANSPORT_HEADROOM_MS

// A run that never reports back leaves its task parked on the AI step. The sweeper is the crash
// backstop, so it force-advances only past the point where a healthy run must already have settled.
const STALLED_RUN_MS = RUN_LEASE_MS + TRANSPORT_HEADROOM_MS

// Runs claimed in one tick execute concurrently, because the dispatcher's own timeout has to cover
// the longest single run rather than their sum. That makes this equally the cap on how many
// assistant runs a single tick can have in flight.
const MAX_RUNS_PER_TICK = 5

// A step is not finished when the assistant stops talking, only when the work it started has
// finished. execute_task_in_vm returns as soon as the job is enqueued, so a run that dispatched one
// parks here instead of settling, and the next tick advances the task once the VM job settles.
const RUN_STATUS_AWAITING_VM = 'awaiting_vm'
const VM_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled']
const ACTIVE_ASSISTANT_RUN_STATUSES = ['running', 'cancel_requested']

// How long to hold a step open for its VM work: the VM's own five-hour agent runtime plus the
// finalization window its Cloud Run task gets for artifacts, Gold settlement and result posting.
// Derived from vmJobConfig so raising the VM budget cannot silently leave this behind.
const AWAITING_VM_TIMEOUT_MS = TARGET_MAX_VM_RUNTIME_MS + VM_JOB_FINALIZATION_HEADROOM_MS

const RUN_STATUS_PENDING = 'pending'
const RUN_STATUS_RUNNING = 'running'
const RUN_STATUS_COMPLETED = 'completed'
const RUN_STATUS_FAILED = 'failed'
const RUN_STATUS_SKIPPED = 'skipped'

const getCurrentStepId = task => {
    const stepHistory = Array.isArray(task && task.stepHistory) ? task.stepHistory : []
    return stepHistory.length > 0 ? stepHistory[stepHistory.length - 1] : null
}

const getUserWorkflow = (user, projectId) => (user && user.workflow && user.workflow[projectId]) || {}

const buildRunId = (projectId, taskId, stepId, enteredAt) => `${projectId}__${taskId}__${stepId}__${enteredAt}`

/**
 * Called for every task update. Enqueues one AI run when a task lands on a step whose reviewer is an
 * assistant.
 *
 * Firestore triggers are at-least-once and an assistant run costs Gold, so the run doc id is
 * deterministic and written with `create()` — a redelivery collides and is dropped.
 */
const enqueueWorkflowAiRunIfNeeded = async (projectId, taskId, oldTask = {}, newTask = {}) => {
    // Subtasks mirror their parent's stepHistory and currentReviewerId (see updateSubtasksState in
    // the client's moveTasksFromMiddleOfWorkflow), so without this a parent with N subtasks would
    // fire N+1 runs and spend N+1× the Gold.
    if (newTask.parentId) return null

    const stepId = getCurrentStepId(newTask)
    if (!stepId || stepId === getCurrentStepId(oldTask)) return null

    const assigneeId = newTask.userId
    if (!assigneeId || assigneeId.startsWith(WORKSTREAM_ID_PREFIX)) return null

    const assignee = await admin.firestore().doc(`users/${assigneeId}`).get()
    if (!assignee.exists) return null

    const step = getUserWorkflow(assignee.data(), projectId)[stepId]
    if (!isAiWorkflowStep(step) || !step.reviewerUid) return null

    // The discriminator has to be derived from the task itself: a redelivery of this same update
    // must produce the same id, or the duplicate would be charged for a second time. Every workflow
    // move stamps `completed`; the stepHistory depth is the deterministic fallback.
    const enteredAt = Number(newTask.completed) || `s${newTask.stepHistory.length}`
    const runId = buildRunId(projectId, taskId, stepId, enteredAt)

    try {
        await admin.firestore().doc(`${RUNS_COLLECTION}/${runId}`).create({
            projectId,
            taskId,
            stepId,
            assistantId: step.reviewerUid,
            assigneeUserId: assigneeId,
            status: RUN_STATUS_PENDING,
            createdAt: Date.now(),
        })
        return runId
    } catch (error) {
        // ALREADY_EXISTS means this update was redelivered; anything else is worth surfacing but must
        // not fail the whole onUpdateTask fan-out.
        if (error.code === 6 || error.code === 'already-exists') {
            console.log('[workflowAiStep] Run already enqueued, skipping duplicate', { runId })
            return null
        }
        console.error('[workflowAiStep] Failed to enqueue run', { runId, error: error.message })
        return null
    }
}

/**
 * Moves a task off `fromStepId` to the next step in its assignee's workflow, or to Done when it was
 * the last one. Mirrors the forward branch of the client's moveTasksFromMiddleOfWorkflow.
 *
 * Gold for the outgoing reviewer is not awarded here: awardGoldForTaskProgress in
 * onUpdateTaskFunctions already fires off the growth of userIds.
 */
const advanceTaskFromWorkflowStep = async (projectId, taskId, task, fromStepId, workflow) => {
    const nextStepId = getNextWorkflowStepId(workflow, fromStepId)
    if (nextStepId === null) {
        console.warn('[workflowAiStep] Step vanished from the workflow, leaving task in place', {
            projectId,
            taskId,
            fromStepId,
        })
        return null
    }

    const now = Date.now()
    const userIds = Array.isArray(task.userIds) ? task.userIds : [task.userId]
    const stepHistory = Array.isArray(task.stepHistory) ? task.stepHistory : []
    const movingToDone = nextStepId === DONE_STEP

    const updateData = movingToDone
        ? {
              userIds: [task.userId],
              currentReviewerId: DONE_STEP,
              completed: now,
              done: true,
              inDone: true,
              sortIndex: now,
          }
        : {
              userIds: [...userIds, workflow[nextStepId].reviewerUid],
              currentReviewerId: workflow[nextStepId].reviewerUid,
              stepHistory: [...stepHistory, nextStepId],
              completed: now,
              dueDate: now,
              done: false,
              inDone: false,
              sortIndex: now,
          }

    const batch = admin.firestore().batch()
    batch.set(admin.firestore().doc(`items/${projectId}/tasks/${taskId}`), updateData, { merge: true })

    const subtaskIds = Array.isArray(task.subtaskIds) ? task.subtaskIds : []
    subtaskIds.forEach(subtaskId => {
        batch.set(
            admin.firestore().doc(`items/${projectId}/tasks/${subtaskId}`),
            { ...updateData, parentDone: movingToDone, inDone: movingToDone },
            { merge: true }
        )
    })

    await batch.commit()

    await writeMovedInWorkflowFeed(projectId, taskId, task, workflow[fromStepId], nextStepId, workflow)

    console.log('[workflowAiStep] Advanced task', { projectId, taskId, fromStepId, nextStepId })
    return nextStepId
}

// Best-effort: the task has already moved, so a feed failure must not make the move look like it
// failed. It only costs the activity-log entry.
const writeMovedInWorkflowFeed = async (projectId, taskId, task, fromStep, nextStepId, workflow) => {
    try {
        const { BatchWrapper } = require('../BatchWrapper/batchWrapper')
        const { createTaskMovedInWorkflowFeed } = require('../Feeds/tasksFeeds')
        const { loadFeedsGlobalState } = require('../GlobalState/globalState')

        const project = await admin.firestore().doc(`projects/${projectId}`).get()
        const projectUserIds = project.exists ? project.data().userIds || [] : []

        // The assistant that just ran authored the move, so the feed is attributed to it.
        const feedUser = { uid: fromStep.reviewerUid }
        loadFeedsGlobalState(admin, admin, feedUser, { id: projectId, userIds: projectUserIds }, [], null)

        const movingToDone = nextStepId === DONE_STEP
        const batch = new BatchWrapper(admin.firestore())

        await createTaskMovedInWorkflowFeed(
            projectId,
            task,
            taskId,
            { description: fromStep.description, userId: fromStep.reviewerUid },
            movingToDone
                ? { description: 'Done', userId: '', isDone: true }
                : { description: workflow[nextStepId].description, userId: workflow[nextStepId].reviewerUid },
            batch,
            feedUser,
            true
        )

        await batch.commit()
    } catch (error) {
        console.error('[workflowAiStep] Could not write workflow feed', { projectId, taskId, error: error.message })
    }
}

const postAssistantComment = async (projectId, taskId, assistantId, commentText) => {
    const commentId = uuidv4()
    await admin.firestore().doc(`chatComments/${projectId}/tasks/${taskId}/comments/${commentId}`).set({
        commentText,
        lastChangeDate: admin.firestore.Timestamp.now(),
        created: Date.now(),
        creatorId: assistantId,
        fromAssistant: true,
        commentType: STAYWARD_COMMENT,
    })
    return commentId
}

/**
 * Posts the step's prompt into the task thread as a comment from the workflow owner, and returns its
 * id for use as the run's trigger message.
 *
 * This is what gives the run the same context an interactive prompt on the task gets.
 * generatePreConfigTaskResult only takes its canonical path — task title, description, project, and
 * prior chat history, assembled by getOptimizedContextMessages — when it is handed a trigger message
 * that lives in the thread. Without one it falls back to base instructions plus the bare prompt, so
 * a workflow step ran with no idea which task it was about. Posting a real comment also means the
 * user reads exactly what the step asked, and leaves the exchange in the history for the next step.
 * Same approach as the VM host task (see postUserRequestComment).
 *
 * Best effort: a thread that could not be seeded still runs, just without the richer context.
 */
const postWorkflowStepPrompt = async (projectId, taskId, assigneeUserId, prompt) => {
    try {
        const { postUserRequestComment } = require('../Assistant/assistantHelper')
        return await postUserRequestComment({
            projectId,
            objectType: 'tasks',
            objectId: taskId,
            creatorId: assigneeUserId,
            text: prompt,
        })
    } catch (error) {
        console.warn('[workflowAiStep] Could not post the step prompt into the thread', {
            projectId,
            taskId,
            error: error.message,
        })
        return null
    }
}

/**
 * Resolves the prompt for an AI step. The pre-config task is read live so later edits to it take
 * effect; the snapshot stored on the step is the fallback for a deleted task.
 */
const resolveAiStepPrompt = async (projectId, step) => {
    if (!step.aiPreConfigTaskId) return buildAiStepPrompt(step)

    const paths = [
        `assistantTasks/${projectId}/${step.reviewerUid}/${step.aiPreConfigTaskId}`,
        `assistantTasks/${projectId}/preConfigTasks/${step.aiPreConfigTaskId}`,
        `assistantTasks/globalProject/preConfigTasks/${step.aiPreConfigTaskId}`,
    ]

    for (const path of paths) {
        try {
            const doc = await admin.firestore().doc(path).get()
            if (doc.exists && doc.data().prompt) return buildAiStepPrompt(step, doc.data().prompt)
        } catch (error) {
            console.warn('[workflowAiStep] Could not read pre-config task', { path, error: error.message })
        }
    }

    return buildAiStepPrompt(step)
}

/**
 * Runs one queued AI step: executes the assistant against the task in its own chat, then moves the
 * task on.
 *
 * The task is advanced whether or not the assistant succeeded — a failed run posts its error into
 * the chat and the pipeline keeps moving rather than parking the task on the step.
 */
const runWorkflowAiStep = async (runId, run) => {
    const { projectId, taskId, stepId, assistantId, assigneeUserId } = run
    const runRef = admin.firestore().doc(`${RUNS_COLLECTION}/${runId}`)
    const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${taskId}`)

    // claimWorkflowAiRun already flipped the doc to `running` and took the lease.
    const taskDoc = await taskRef.get()
    if (!taskDoc.exists) {
        await runRef.set({ status: RUN_STATUS_SKIPPED, reason: 'task_deleted', settledAt: Date.now() }, { merge: true })
        return
    }

    const task = { ...taskDoc.data(), id: taskId }
    if (getCurrentStepId(task) !== stepId) {
        await runRef.set({ status: RUN_STATUS_SKIPPED, reason: 'task_moved', settledAt: Date.now() }, { merge: true })
        return
    }

    const assignee = await admin.firestore().doc(`users/${assigneeUserId}`).get()
    const workflow = getUserWorkflow(assignee.exists ? assignee.data() : null, projectId)
    const step = workflow[stepId]

    const taskRunLock = await acquireAssistantTaskRunLock(admin.firestore(), {
        projectId,
        objectType: 'tasks',
        objectId: taskId,
        ownerId: runId,
        kind: 'workflow',
        workflowStepId: stepId,
    })

    if (!taskRunLock.acquired) {
        const activeKind = taskRunLock.existing && taskRunLock.existing.kind
        const activeWorkflowStepId = taskRunLock.existing && taskRunLock.existing.workflowStepId
        if (activeKind === 'workflow' && activeWorkflowStepId === stepId) {
            // A second transition/update can enqueue a different run id for the same step. The run
            // already holding the task slot owns advancing it; this duplicate must not move the task
            // out from underneath that run.
            await runRef.set(
                { status: RUN_STATUS_SKIPPED, reason: 'workflow_run_already_active', settledAt: Date.now() },
                { merge: true }
            )
            return
        }

        // A comment-triggered run can already have dispatched VM work for this task. That work
        // satisfies the AI step, but only after it actually finishes.
        const activeVmCorrelationIds = await findUnsettledVmJobs(projectId, taskId)
        if (activeVmCorrelationIds.length > 0) {
            await parkWorkflowAiRunForVm(runRef, runId, taskId, activeVmCorrelationIds, 'task_ai_run_already_active')
            return
        }

        // A non-VM comment-triggered assistant run already owns the task. Preserve the existing
        // behaviour: treat the AI workflow step as satisfied without executing its prompt twice.
        await finalizeWorkflowAiRun(runId, run, workflow, null, 'task_ai_run_already_active')
        return
    }

    try {
        // A VM launched from the task chat can outlive the prompt and its task lock. It still owns
        // the work at this AI step, so park until it settles instead of immediately advancing.
        const existingVmCorrelationIds = await findUnsettledVmJobs(projectId, taskId)
        if (existingVmCorrelationIds.length > 0) {
            await parkWorkflowAiRunForVm(runRef, runId, taskId, existingVmCorrelationIds, 'task_ai_run_already_active')
            return
        }

        // Covers interactive locks written by older instances during a rolling deployment.
        if (await hasActiveAiTaskJob(projectId, taskId)) {
            await finalizeWorkflowAiRun(runId, run, workflow, null, 'task_ai_run_already_active')
            return
        }

        let failureReason = null

        if (!isAiWorkflowStep(step)) {
            // The step was edited or deleted while the run was queued — nothing to run, just move on.
            failureReason = 'step_no_longer_ai'
        } else {
            try {
                const prompt = await resolveAiStepPrompt(projectId, step)
                if (!prompt.trim()) {
                    failureReason = 'empty_prompt'
                } else {
                    const isPublicFor = task.isPublicFor || [FEED_PUBLIC_FOR_ALL]
                    const followerIds = Array.from(new Set([assigneeUserId, ...(task.userIds || [])])).filter(
                        id => id && !id.startsWith(WORKSTREAM_ID_PREFIX)
                    )

                    const { ensureChatExists } = require('../Assistant/assistantStatusHelper')
                    await ensureChatExists(projectId, 'tasks', taskId, assistantId, followerIds, isPublicFor)

                    const triggerMessageId = await postWorkflowStepPrompt(projectId, taskId, assigneeUserId, prompt)

                    const { generatePreConfigTaskResult } = require('../Assistant/assistantPreConfigTaskTopic')
                    await generatePreConfigTaskResult(
                        // The assignee owns the workflow, so the assignee pays the Gold.
                        assigneeUserId,
                        projectId,
                        taskId,
                        followerIds,
                        isPublicFor,
                        assistantId,
                        prompt,
                        assignee.exists ? assignee.data().language || 'en' : 'en',
                        // null lets the assistant's own model/temperature/instructions/tools apply.
                        null,
                        { name: task.extendedName || task.name },
                        null,
                        'tasks',
                        // Grounds the run in the task it is about; see postWorkflowStepPrompt.
                        { triggerMessageId }
                    )
                }
            } catch (error) {
                console.error('[workflowAiStep] Assistant run failed', { runId, error: error.message })
                failureReason = error.message || 'run_failed'
                try {
                    await postAssistantComment(
                        projectId,
                        taskId,
                        assistantId,
                        `⚠️ This workflow step could not be completed: ${failureReason}`
                    )
                } catch (commentError) {
                    console.error('[workflowAiStep] Could not post failure comment', {
                        runId,
                        error: commentError.message,
                    })
                }
            }
        }

        // The assistant answering is not the same as the step's work being finished. execute_task_in_vm
        // returns as soon as the job is enqueued, so a step that dispatched one would otherwise hand the
        // task to the next reviewer while the work it asked for is still running — for up to five hours.
        if (!failureReason) {
            const awaitingCorrelationIds = await findUnsettledVmJobs(projectId, taskId)
            if (awaitingCorrelationIds.length > 0) {
                await parkWorkflowAiRunForVm(runRef, runId, taskId, awaitingCorrelationIds)
                return
            }
        }

        await finalizeWorkflowAiRun(runId, run, workflow, failureReason)
    } finally {
        await releaseAssistantTaskRunLock(taskRunLock.lockRef, runId)
    }
}

const parkWorkflowAiRunForVm = async (runRef, runId, taskId, awaitingCorrelationIds, skipReason = null) => {
    const now = Date.now()
    await runRef.set(
        {
            status: RUN_STATUS_AWAITING_VM,
            awaitingCorrelationIds,
            // Re-query the task while parked. This includes queued follow-up VMs and jobs launched
            // concurrently in the same task chat, rather than freezing the first snapshot.
            awaitingAnyTaskVm: true,
            ...(skipReason ? { awaitingSkipReason: skipReason } : {}),
            awaitingSince: now,
            awaitingUntil: now + AWAITING_VM_TIMEOUT_MS,
        },
        { merge: true }
    )
    console.log('[workflowAiStep] Holding the step until task VM work finishes', {
        runId,
        taskId,
        awaitingCorrelationIds,
    })
}

/**
 * Moves the task off the step and settles the run. Split out of runWorkflowAiStep because a run that
 * dispatched VM work reaches this point later, from resolveAwaitingVmRuns.
 */
const finalizeWorkflowAiRun = async (runId, run, workflow, failureReason, skipReason = null) => {
    const { projectId, taskId, stepId } = run
    const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${taskId}`)

    // Re-read before moving: the assistant can move the task itself (update_task), and a human may
    // have moved it while the run was in flight. Whoever moved it last wins.
    const latestDoc = await taskRef.get()
    const latest = latestDoc.exists ? { ...latestDoc.data(), id: taskId } : null

    if (latest && getCurrentStepId(latest) === stepId) {
        await advanceTaskFromWorkflowStep(projectId, taskId, latest, stepId, workflow)
    } else {
        console.log('[workflowAiStep] Task already moved on, skipping advance', { runId, taskId })
    }

    await admin
        .firestore()
        .doc(`${RUNS_COLLECTION}/${runId}`)
        .set(
            {
                status: skipReason ? RUN_STATUS_SKIPPED : failureReason ? RUN_STATUS_FAILED : RUN_STATUS_COMPLETED,
                ...(skipReason ? { reason: skipReason } : {}),
                ...(failureReason ? { failureReason } : {}),
                settledAt: Date.now(),
            },
            { merge: true }
        )
}

/**
 * Returns whether another authoritative AI execution mechanism is still active on this task.
 *
 * The task-level lock handles new comment/workflow races atomically. These collection checks cover
 * VM jobs (which can outlive the prompt that launched them) and interactive locks written by an
 * older function instance during a rolling deployment.
 */
const hasActiveAiTaskJob = async (projectId, taskId, now = Date.now()) => {
    const [assistantRuns, vmJobs] = await Promise.all([
        admin.firestore().collection('assistantRunLocks').where('objectId', '==', taskId).get(),
        admin.firestore().collection('pendingWebhooks').where('objectId', '==', taskId).get(),
    ])

    const activeAssistantRun = assistantRuns.docs.some(doc => {
        const run = doc.data() || {}
        return (
            run.projectId === projectId &&
            (run.objectType || 'tasks') === 'tasks' &&
            ACTIVE_ASSISTANT_RUN_STATUSES.includes(run.status) &&
            Number(run.lockExpiresAt || 0) > now
        )
    })
    if (activeAssistantRun) return true

    return vmJobs.docs.some(doc => {
        const job = doc.data() || {}
        return (
            job.kind === 'vm_job' &&
            job.projectId === projectId &&
            (job.objectType || 'tasks') === 'tasks' &&
            !VM_TERMINAL_STATUSES.includes(job.status)
        )
    })
}

/**
 * Correlation ids of VM jobs on this task that have not settled yet.
 *
 * Queried on objectId alone — a single-field lookup Firestore indexes automatically — and narrowed in
 * memory, because a task only ever has a handful of VM jobs and a composite index would have to be
 * created by hand (see the Firestore indexes notes in CLAUDE.md).
 */
const findUnsettledVmJobs = async (projectId, taskId) => {
    try {
        const snapshot = await admin.firestore().collection('pendingWebhooks').where('objectId', '==', taskId).get()

        return snapshot.docs
            .filter(doc => {
                const job = doc.data() || {}
                return (
                    job.kind === 'vm_job' &&
                    job.projectId === projectId &&
                    (job.objectType || 'tasks') === 'tasks' &&
                    !VM_TERMINAL_STATUSES.includes(job.status)
                )
            })
            .map(doc => doc.id)
    } catch (error) {
        // Failing open advances the task, which is the behaviour this had before it waited at all.
        console.warn('[workflowAiStep] Could not check for VM jobs, advancing', { taskId, error: error.message })
        return []
    }
}

/**
 * Of the given VM correlation ids, the ones that have not reached a terminal status. A job whose doc
 * has gone is treated as settled rather than waited on forever.
 */
const filterUnsettledVmJobs = async correlationIds => {
    const ids = Array.isArray(correlationIds) ? correlationIds : []
    const unsettled = []

    for (const correlationId of ids) {
        try {
            const doc = await admin.firestore().doc(`pendingWebhooks/${correlationId}`).get()
            if (!doc.exists) continue

            const job = doc.data() || {}
            if (VM_TERMINAL_STATUSES.includes(job.status)) continue

            unsettled.push({
                correlationId,
                status: job.status,
                // Set while the VM agent is blocked on a question (see vmInteraction.js).
                interactionExpiresAt: Number(job.interactionExpiresAt) || 0,
            })
        } catch (error) {
            // Failing open advances the step rather than parking the task on a read error.
            console.warn('[workflowAiStep] Could not read VM job status', { correlationId, error: error.message })
        }
    }

    return unsettled
}

/**
 * When to stop waiting on the VM jobs a step dispatched.
 *
 * Normally the step's own `awaitingUntil` governs: the VM's runtime plus its finalization window. But
 * a VM agent can stop and ask the user a question (`awaiting_user`), and that interaction stays open
 * for VM_INTERACTION_TTL_MS — 24 hours, far longer than the run budget. Giving up at the plain budget
 * would abandon a step the user can still rescue by answering, so a live interaction pushes the
 * deadline out to when the question expires, plus a full run budget for the job to finish afterwards.
 *
 * Still bounded: each extension needs a real, unexpired interaction, so a job that simply hangs is
 * abandoned on the original schedule.
 */
const resolveAwaitingDeadline = (run, unsettledJobs) => {
    const base = Number(run.awaitingUntil) || 0
    const interactionExpiresAt = unsettledJobs.reduce((latest, job) => Math.max(latest, job.interactionExpiresAt), 0)

    return interactionExpiresAt ? Math.max(base, interactionExpiresAt + AWAITING_VM_TIMEOUT_MS) : base
}

/**
 * Advances runs that were parked waiting on VM work, once that work settles.
 *
 * A failed or cancelled VM job still advances the task: it matches how a failed assistant run behaves
 * (the error is posted into the chat and the pipeline keeps moving) rather than parking the task
 * where nobody is looking. The same applies once the deadline passes, which is the backstop for a VM
 * job whose status never reaches a terminal state — see resolveAwaitingDeadline for why a job blocked
 * on a user question gets longer than the plain run budget.
 */
const resolveAwaitingVmRuns = async ({ now = Date.now() } = {}) => {
    const snapshot = await admin
        .firestore()
        .collection(RUNS_COLLECTION)
        .where('status', '==', RUN_STATUS_AWAITING_VM)
        .limit(MAX_RUNS_PER_TICK)
        .get()

    if (snapshot.empty) return 0

    let resolved = 0
    for (const doc of snapshot.docs) {
        const run = doc.data() || {}
        try {
            // Re-query task-wide so pre-existing chat VMs, queued follow-up VMs, and VM jobs launched
            // while this run is parked all keep the AI step open.
            const correlationIds = run.awaitingAnyTaskVm
                ? await findUnsettledVmJobs(run.projectId, run.taskId)
                : run.awaitingCorrelationIds
            const stillRunning = await filterUnsettledVmJobs(correlationIds)
            const timedOut = now >= resolveAwaitingDeadline(run, stillRunning)
            if (stillRunning.length > 0 && !timedOut) continue

            const assignee = await admin.firestore().doc(`users/${run.assigneeUserId}`).get()
            const workflow = getUserWorkflow(assignee.exists ? assignee.data() : null, run.projectId)

            await finalizeWorkflowAiRun(
                doc.id,
                run,
                workflow,
                timedOut && stillRunning.length > 0 ? 'vm_timeout' : null,
                timedOut && stillRunning.length > 0 ? null : run.awaitingSkipReason || null
            )
            resolved++
            console.log('[workflowAiStep] VM work finished, advancing the step', {
                runId: doc.id,
                taskId: run.taskId,
                timedOut,
            })
        } catch (error) {
            console.error('[workflowAiStep] Could not resolve awaiting run', { runId: doc.id, error: error.message })
        }
    }

    return resolved
}

/**
 * Takes exclusive ownership of a queued run, returning its data, or null when someone else already
 * has it.
 *
 * Ticks overlap by design: the schedule fires every minute and a run may last the better part of an
 * hour, so several dispatchers are routinely alive at once and would otherwise all pick up the same
 * oldest pending run. The transaction is what makes "pending" a one-shot claim.
 */
const claimWorkflowAiRun = async (runRef, leaseOwner, now = Date.now()) => {
    return admin.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(runRef)
        if (!snapshot.exists) return null

        const run = snapshot.data() || {}
        if (run.status !== RUN_STATUS_PENDING) return null

        transaction.set(
            runRef,
            { status: RUN_STATUS_RUNNING, startedAt: now, leaseOwner, leaseExpiresAt: now + RUN_LEASE_MS },
            { merge: true }
        )
        return run
    })
}

/**
 * Executes the queued AI runs, oldest first.
 *
 * This is a poller rather than a Firestore trigger because an assistant run is given a 55-minute
 * wall clock (see assistantRunLimits) and event-triggered functions are capped at 540s, so a trigger
 * physically cannot host one. Scheduled execution is how checkRecurringAssistantTasks already runs
 * assistant work for the same budget.
 */
const dispatchPendingWorkflowAiRuns = async ({ now = Date.now(), leaseOwner = uuidv4() } = {}) => {
    // Runs parked on VM work are settled by the same tick, so a finished VM job advances its step
    // within a minute without needing a schedule of its own.
    await resolveAwaitingVmRuns({ now }).catch(error =>
        console.error('[workflowAiStep] Could not resolve awaiting runs', { error: error.message })
    )

    const snapshot = await admin
        .firestore()
        .collection(RUNS_COLLECTION)
        .where('status', '==', RUN_STATUS_PENDING)
        .orderBy('createdAt', 'asc')
        .limit(MAX_RUNS_PER_TICK)
        .get()

    if (snapshot.empty) return 0

    const claimed = []
    for (const doc of snapshot.docs) {
        try {
            const run = await claimWorkflowAiRun(doc.ref, leaseOwner, now)
            if (run) claimed.push({ runId: doc.id, run })
        } catch (error) {
            console.error('[workflowAiStep] Could not claim run', { runId: doc.id, error: error.message })
        }
    }

    if (claimed.length === 0) return 0

    await Promise.all(
        claimed.map(({ runId, run }) =>
            runWorkflowAiStep(runId, run).catch(async error => {
                // runWorkflowAiStep settles its own doc for anything the assistant does; reaching here
                // means the surrounding bookkeeping threw, which would strand the run at `running`
                // until the sweeper noticed it an hour later.
                console.error('[workflowAiStep] Run threw outside its own error handling', {
                    runId,
                    error: error.message,
                })
                await admin
                    .firestore()
                    .doc(`${RUNS_COLLECTION}/${runId}`)
                    .set(
                        { status: RUN_STATUS_FAILED, failureReason: error.message || 'run_failed', settledAt: now },
                        { merge: true }
                    )
                    .catch(() => {})
            })
        )
    )

    console.log('[workflowAiStep] Dispatched runs', { count: claimed.length })
    return claimed.length
}

/**
 * Backstop for a worker that died without settling its run, which would otherwise leave the task
 * parked on the AI step forever.
 */
const sweepStalledWorkflowAiRuns = async () => {
    const cutoff = Date.now() - STALLED_RUN_MS
    const stalled = await admin
        .firestore()
        .collection(RUNS_COLLECTION)
        .where('status', 'in', [RUN_STATUS_PENDING, RUN_STATUS_RUNNING])
        .where('createdAt', '<', cutoff)
        .get()

    if (stalled.empty) return 0

    for (const doc of stalled.docs) {
        const run = doc.data()
        try {
            const taskDoc = await admin.firestore().doc(`items/${run.projectId}/tasks/${run.taskId}`).get()
            if (taskDoc.exists) {
                const task = { ...taskDoc.data(), id: run.taskId }
                if (getCurrentStepId(task) === run.stepId) {
                    const assignee = await admin.firestore().doc(`users/${run.assigneeUserId}`).get()
                    const workflow = getUserWorkflow(assignee.exists ? assignee.data() : null, run.projectId)
                    await advanceTaskFromWorkflowStep(run.projectId, run.taskId, task, run.stepId, workflow)
                }
            }
            await doc.ref.set(
                { status: RUN_STATUS_FAILED, failureReason: 'stalled', settledAt: Date.now() },
                { merge: true }
            )
        } catch (error) {
            console.error('[workflowAiStep] Could not sweep stalled run', { runId: doc.id, error: error.message })
        }
    }

    console.log('[workflowAiStep] Swept stalled runs', { count: stalled.size })
    return stalled.size
}

module.exports = {
    AWAITING_VM_TIMEOUT_MS,
    MAX_RUNS_PER_TICK,
    RUNS_COLLECTION,
    RUN_LEASE_MS,
    RUN_STATUS_AWAITING_VM,
    STALLED_RUN_MS,
    advanceTaskFromWorkflowStep,
    claimWorkflowAiRun,
    dispatchPendingWorkflowAiRuns,
    enqueueWorkflowAiRunIfNeeded,
    hasActiveAiTaskJob,
    resolveAwaitingVmRuns,
    runWorkflowAiStep,
    sweepStalledWorkflowAiRuns,
}
