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
                    'tasks'
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
                console.error('[workflowAiStep] Could not post failure comment', { runId, error: commentError.message })
            }
        }
    }

    // Re-read before moving: the assistant can move the task itself (update_task), and a human may
    // have moved it while the run was in flight. Whoever moved it last wins.
    const latestDoc = await taskRef.get()
    const latest = latestDoc.exists ? { ...latestDoc.data(), id: taskId } : null

    if (latest && getCurrentStepId(latest) === stepId) {
        await advanceTaskFromWorkflowStep(projectId, taskId, latest, stepId, workflow)
    } else {
        console.log('[workflowAiStep] Task already moved on, skipping advance', { runId, taskId })
    }

    await runRef.set(
        {
            status: failureReason ? RUN_STATUS_FAILED : RUN_STATUS_COMPLETED,
            ...(failureReason ? { failureReason } : {}),
            settledAt: Date.now(),
        },
        { merge: true }
    )
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
    MAX_RUNS_PER_TICK,
    RUNS_COLLECTION,
    RUN_LEASE_MS,
    STALLED_RUN_MS,
    advanceTaskFromWorkflowStep,
    claimWorkflowAiRun,
    dispatchPendingWorkflowAiRuns,
    enqueueWorkflowAiRunIfNeeded,
    runWorkflowAiStep,
    sweepStalledWorkflowAiRuns,
}
