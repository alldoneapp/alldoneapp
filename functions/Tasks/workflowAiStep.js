const admin = require('firebase-admin')
const { v4: uuidv4 } = require('uuid')

const {
    DONE_STEP,
    FEED_PUBLIC_FOR_ALL,
    STAYWARD_COMMENT,
    WORKSTREAM_ID_PREFIX,
} = require('../Utils/HelperFunctionsCloud')
const { buildWorkflowStepAdvanceUpdate, isAiWorkflowStep, buildAiStepPrompt } = require('./workflowStepHelper')
const { SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS, TRANSPORT_HEADROOM_MS } = require('../Assistant/assistantRunLimits')
const { TARGET_MAX_VM_RUNTIME_MS, VM_JOB_FINALIZATION_HEADROOM_MS } = require('../Assistant/vmJobConfig')
const { acquireAssistantTaskRunLock, releaseAssistantTaskRunLock } = require('../Assistant/assistantRunIdempotency')
const { Timestamp } = require('firebase-admin/firestore')

const RUNS_COLLECTION = 'workflowAiRuns'

// A claimed run occupies its slot for a whole assistant wall clock plus the work either side of it,
// so the lease has to outlast a healthy run or a second tick would start it again while it is still
// going. Sized off the scheduled wall clock because this dispatcher runs inside an onSchedule
// function: leasing for longer than that host can live would park a task behind a run whose process
// Cloud Scheduler had already given up on.
const RUN_LEASE_MS = SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS + TRANSPORT_HEADROOM_MS

// A run that never reports back leaves its task parked on the AI step. The sweeper is the crash
// backstop, so it force-advances only past the point where a healthy run must already have settled.
const STALLED_RUN_MS = RUN_LEASE_MS + TRANSPORT_HEADROOM_MS

// Runs claimed in one tick execute concurrently, because the dispatcher's own timeout has to cover
// the longest single run rather than their sum. That makes this equally the cap on how many
// assistant runs a single tick can have in flight.
const MAX_RUNS_PER_TICK = 5

// A step is not finished when the assistant stops talking, only when the work it started has
// finished. execute_task_in_vm returns as soon as the job is enqueued, so a run that dispatched one
// parks here instead of settling. The VM runner re-checks it after terminal finalization, with the
// scheduled dispatcher retained as a recovery backstop.
const RUN_STATUS_AWAITING_VM = 'awaiting_vm'
const VM_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled']
// Chat execution is authoritative before execute_task_in_vm has created its pendingWebhooks record.
// Include the admission states as well as the states currently written by assistantRunIdempotency so
// this remains safe if chat dispatch starts persisting its queue explicitly.
const ACTIVE_ASSISTANT_RUN_STATUSES = ['pending', 'queued', 'starting', 'running', 'cancel_requested']

// How long to hold a step open for its VM work: the VM's own five-hour agent runtime plus the
// finalization window its Cloud Run task gets for artifacts, Gold settlement and result posting.
// Derived from vmJobConfig so raising the VM budget cannot silently leave this behind.
const AWAITING_VM_TIMEOUT_MS = TARGET_MAX_VM_RUNTIME_MS + VM_JOB_FINALIZATION_HEADROOM_MS

const RUN_STATUS_PENDING = 'pending'
const RUN_STATUS_RUNNING = 'running'
const RUN_STATUS_COMPLETED = 'completed'
const RUN_STATUS_FAILED = 'failed'
const RUN_STATUS_SKIPPED = 'skipped'
const RUN_TERMINAL_STATUSES = [RUN_STATUS_COMPLETED, RUN_STATUS_FAILED, RUN_STATUS_SKIPPED]

const setTaskWorkflowAiStatus = async (projectId, taskId, runId, stepId, status, failureReason = null) => {
    if (!projectId || !taskId) return
    try {
        await admin
            .firestore()
            .doc(`items/${projectId}/tasks/${taskId}`)
            .set(
                {
                    workflowAiStatus: {
                        runId,
                        stepId,
                        status,
                        failureReason,
                        updatedAt: Date.now(),
                    },
                },
                { merge: true }
            )
    } catch (error) {
        console.error('[workflowAiStep] Could not persist task run status', {
            projectId,
            taskId,
            runId,
            status,
            error: error.message,
        })
    }
}

const getCurrentStepId = task => {
    const stepHistory = Array.isArray(task && task.stepHistory) ? task.stepHistory : []
    return stepHistory.length > 0 ? stepHistory[stepHistory.length - 1] : null
}

const getWorkflow = (owner, projectId) => (owner && owner.workflow && owner.workflow[projectId]) || {}

const isAssistantWorkflowTask = task => task?.workflowTask === true

const getWorkflowOwnerRef = (projectId, ownerType, ownerId) =>
    ownerType === 'assistant'
        ? admin.firestore().doc(`assistants/${projectId}/items/${ownerId}`)
        : admin.firestore().doc(`users/${ownerId}`)

const loadRunWorkflow = async run => {
    const workflowOwnerType = run.workflowOwnerType || 'user'
    const workflowOwnerId = run.workflowOwnerId || run.assigneeUserId
    const owner = await getWorkflowOwnerRef(run.projectId, workflowOwnerType, workflowOwnerId).get()
    return getWorkflow(owner.exists ? owner.data() : null, run.projectId)
}

const buildRunId = (projectId, taskId, stepId, enteredAt) => `${projectId}__${taskId}__${stepId}__${enteredAt}`

/**
 * The fields that park a run on work that is already running on the task, instead of executing the
 * step's configured prompt. Shared so the two moments that can park a run — the task trigger below
 * and the dispatcher — cannot drift apart.
 */
const buildAwaitingExecutionFields = ({ assistantRunIds = [], vmCorrelationIds = [], skipReason = null, now }) => ({
    status: RUN_STATUS_AWAITING_VM,
    awaitingAssistantRunIds: assistantRunIds,
    awaitingCorrelationIds: vmCorrelationIds,
    // Re-query the task while parked. This bridges the pre-VM window: the assistant run is
    // visible first, then the VM record takes over without an empty poll advancing the step.
    awaitingAnyTaskExecution: true,
    awaitingAnyTaskVm: true,
    ...(skipReason ? { awaitingSkipReason: skipReason } : {}),
    awaitingSince: now,
    awaitingUntil: now + AWAITING_VM_TIMEOUT_MS,
})

/**
 * Whether AI work is running on this task right now, and what to wait for.
 *
 * Only genuinely live work counts: a settled chat run or a terminal VM job never suppresses a step.
 * Workflow runs themselves are invisible here — they write no message lock — so a step can never
 * park on itself or on the AI step that just handed the task over.
 */
const findLiveTaskAiWork = async (projectId, taskId, now = Date.now()) => {
    const [assistantRunIds, vmCorrelationIds] = await Promise.all([
        findActiveAssistantRuns(projectId, taskId, now),
        findUnsettledVmJobs(projectId, taskId),
    ])

    return { assistantRunIds, vmCorrelationIds, isLive: assistantRunIds.length > 0 || vmCorrelationIds.length > 0 }
}

/**
 * Called for every task update. Enqueues one AI run when a task lands on a step whose reviewer is an
 * assistant.
 *
 * Firestore triggers are at-least-once and an assistant run costs Gold, so the run doc id is
 * deterministic and written with `create()` — a redelivery collides and is dropped.
 *
 * A run that lands on a task the assistant is already working on is created parked rather than
 * pending, so the step's configured prompt is never posted on top of that work.
 */
const enqueueWorkflowAiRunIfNeeded = async (projectId, taskId, oldTask = {}, newTask = {}) => {
    // Subtasks mirror their parent's stepHistory and currentReviewerId (see updateSubtasksState in
    // the client's moveTasksFromMiddleOfWorkflow), so without this a parent with N subtasks would
    // fire N+1 runs and spend N+1× the Gold.
    if (newTask.parentId) return null

    const stepId = getCurrentStepId(newTask)
    if (!stepId || stepId === getCurrentStepId(oldTask)) return null

    const workflowOwnerId = newTask.userId
    if (!workflowOwnerId || workflowOwnerId.startsWith(WORKSTREAM_ID_PREFIX)) return null

    const workflowOwnerType = isAssistantWorkflowTask(newTask) ? 'assistant' : 'user'
    const workflowOwner = await getWorkflowOwnerRef(projectId, workflowOwnerType, workflowOwnerId).get()
    if (!workflowOwner.exists) return null

    const step = getWorkflow(workflowOwner.data(), projectId)[stepId]
    if (!isAiWorkflowStep(step) || !step.reviewerUid) return null

    const payerUserId =
        workflowOwnerType === 'assistant'
            ? newTask.workflowPayerUserId || newTask.creatorId
            : newTask.workflowPayerUserId || workflowOwnerId
    if (!payerUserId) return null

    // The discriminator has to be derived from the task itself: a redelivery of this same update
    // must produce the same id, or the duplicate would be charged for a second time. Every workflow
    // move stamps `completed`; the stepHistory depth is the deterministic fallback.
    const enteredAt = Number(newTask.completed) || `s${newTask.stepHistory.length}`
    const runId = buildRunId(projectId, taskId, stepId, enteredAt)
    const persistedOverride = newTask.workflowAiPromptOverride
    const promptOverride =
        persistedOverride &&
        persistedOverride.stepId === stepId &&
        typeof persistedOverride.prompt === 'string' &&
        persistedOverride.prompt.trim()
            ? persistedOverride
            : null

    // Whether the assistant is already working this task has to be decided HERE, in the task
    // trigger, because this is the only moment that is synchronous with the task landing on the
    // step. The dispatcher is a one-minute poller, and a normal assistant answer routinely finishes
    // well inside that gap: by the time the poller looked, nothing was live any more and the step
    // posted its configured prompt anyway — right after the answer the user had just read. A VM job
    // masked this, because it stays live for hours and is therefore still visible at the next tick.
    // The dispatcher keeps its own checks for work that starts during the gap and is still running.
    const now = Date.now()
    const liveWork = await findLiveTaskAiWork(projectId, taskId, now)

    try {
        await admin
            .firestore()
            .doc(`${RUNS_COLLECTION}/${runId}`)
            .create({
                projectId,
                taskId,
                stepId,
                assistantId: step.reviewerUid,
                assigneeUserId: payerUserId,
                workflowOwnerId,
                workflowOwnerType,
                payerUserId,
                ...(promptOverride
                    ? {
                          promptOverride: promptOverride.prompt,
                          triggerMessageId: promptOverride.triggerMessageId || null,
                      }
                    : {}),
                ...(liveWork.isLive
                    ? buildAwaitingExecutionFields({
                          assistantRunIds: liveWork.assistantRunIds,
                          vmCorrelationIds: liveWork.vmCorrelationIds,
                          skipReason: 'task_ai_run_already_active',
                          now,
                      })
                    : { status: RUN_STATUS_PENDING }),
                createdAt: now,
            })
        const status = liveWork.isLive ? RUN_STATUS_AWAITING_VM : RUN_STATUS_PENDING
        await setTaskWorkflowAiStatus(projectId, taskId, runId, stepId, status)
        if (liveWork.isLive) {
            console.log('[workflowAiStep] Task already has live AI work, holding the step prompt', {
                runId,
                taskId,
                assistantRunIds: liveWork.assistantRunIds,
                vmCorrelationIds: liveWork.vmCorrelationIds,
            })
        }
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
    const transition = buildWorkflowStepAdvanceUpdate(task, fromStepId, workflow)
    if (!transition) {
        console.warn('[workflowAiStep] Step vanished from the workflow, leaving task in place', {
            projectId,
            taskId,
            fromStepId,
        })
        return null
    }

    const { nextStepId, movingToDone, updateData } = transition

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
        lastChangeDate: Timestamp.now(),
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
 * Makes the workflow reviewer the task's active thread assistant before its prompt is posted.
 *
 * The client can source assistant state from either the task or an existing chat object, so both
 * records must change together. This also lets a user comment while the workflow assistant or its
 * VM work is still running and have that comment enter the normal assistant/VM queue.
 */
const activateWorkflowTaskAssistant = async (projectId, taskId, assistantId) => {
    const db = admin.firestore()
    const assistantState = { assistantId, isAssistantEnabled: true }
    const batch = db.batch()

    batch.set(db.doc(`items/${projectId}/tasks/${taskId}`), assistantState, { merge: true })
    batch.set(db.doc(`chatObjects/${projectId}/chats/${taskId}`), assistantState, { merge: true })

    await batch.commit()
}

/**
 * Resolves the prompt for an AI step. The pre-config task is read live so later edits to it take
 * effect; the snapshot stored on the step is the fallback for a deleted task.
 */
const resolveAiStepPrompt = async (projectId, step, promptOverride = null) => {
    // A non-empty transition-popup comment replaces the configured action for this run exactly. It
    // is intentionally not augmented with the step prompt or substituted with the step's variables.
    if (typeof promptOverride === 'string' && promptOverride.trim()) return promptOverride
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
 * The task advances only after a successful run. Failed work remains on the assistant step so it is
 * visible in the active task list and can be retried deliberately.
 */
const runWorkflowAiStep = async (runId, run) => {
    const { projectId, taskId, stepId, assistantId, assigneeUserId } = run
    const workflowOwnerType = run.workflowOwnerType || 'user'
    const workflowOwnerId = run.workflowOwnerId || assigneeUserId
    const payerUserId = run.payerUserId || assigneeUserId
    const runRef = admin.firestore().doc(`${RUNS_COLLECTION}/${runId}`)
    const taskRef = admin.firestore().doc(`items/${projectId}/tasks/${taskId}`)

    // claimWorkflowAiRun already flipped the doc to `running` and took the lease.
    const taskDoc = await taskRef.get()
    if (!taskDoc.exists) {
        await runRef.set({ status: RUN_STATUS_SKIPPED, reason: 'task_deleted', settledAt: Date.now() }, { merge: true })
        return
    }

    await setTaskWorkflowAiStatus(projectId, taskId, runId, stepId, RUN_STATUS_RUNNING)

    const task = { ...taskDoc.data(), id: taskId }
    if (getCurrentStepId(task) !== stepId) {
        await runRef.set({ status: RUN_STATUS_SKIPPED, reason: 'task_moved', settledAt: Date.now() }, { merge: true })
        return
    }

    const [workflowOwner, payer] = await Promise.all([
        getWorkflowOwnerRef(projectId, workflowOwnerType, workflowOwnerId).get(),
        admin.firestore().doc(`users/${payerUserId}`).get(),
    ])
    const workflow = getWorkflow(workflowOwner.exists ? workflowOwner.data() : null, projectId)
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

        // The chat run owns this AI step even before execute_task_in_vm has created a VM record.
        // Park on the assistant execution first; if it dispatches a VM, the resolver seamlessly
        // switches to waiting on that job after the chat run itself settles.
        await parkWorkflowAiRunForExecution(
            runRef,
            runId,
            taskId,
            {
                assistantRunIds: [taskRunLock.existing && taskRunLock.existing.ownerId].filter(Boolean),
            },
            'task_ai_run_already_active'
        )
        return
    }

    try {
        // Covers both halves of the lifecycle: the chat execution before VM creation and the VM
        // after it has outlived the prompt/task lock. Message-level locks also cover older function
        // instances during a rolling deployment.
        const existingAssistantRunIds = await findActiveAssistantRuns(projectId, taskId)
        if (existingAssistantRunIds.length > 0) {
            await parkWorkflowAiRunForExecution(
                runRef,
                runId,
                taskId,
                {
                    assistantRunIds: existingAssistantRunIds,
                },
                'task_ai_run_already_active'
            )
            return
        }
        const existingVmCorrelationIds = await findUnsettledVmJobs(projectId, taskId)
        if (existingVmCorrelationIds.length > 0) {
            await parkWorkflowAiRunForExecution(
                runRef,
                runId,
                taskId,
                { vmCorrelationIds: existingVmCorrelationIds },
                'task_ai_run_already_active'
            )
            return
        }

        let failureReason = null

        if (!isAiWorkflowStep(step)) {
            // The step was edited or deleted while the run was queued — nothing to run, just move on.
            failureReason = 'step_no_longer_ai'
        } else {
            try {
                const hasPromptOverride = typeof run.promptOverride === 'string' && !!run.promptOverride.trim()
                const prompt = await resolveAiStepPrompt(projectId, step, run.promptOverride)
                if (!prompt.trim()) {
                    failureReason = 'empty_prompt'
                } else {
                    const isPublicFor = task.isPublicFor || [FEED_PUBLIC_FOR_ALL]
                    const followerIds = Array.from(new Set([payerUserId, ...(task.userIds || [])])).filter(
                        id =>
                            id &&
                            !id.startsWith(WORKSTREAM_ID_PREFIX) &&
                            !(workflowOwnerType === 'assistant' && id === workflowOwnerId)
                    )

                    const { ensureChatExists } = require('../Assistant/assistantStatusHelper')
                    await ensureChatExists(projectId, 'tasks', taskId, assistantId, followerIds, isPublicFor)
                    await activateWorkflowTaskAssistant(projectId, taskId, assistantId)

                    // The popup comment was persisted before the atomic task move and its id was
                    // copied into this run. Reuse it as context instead of posting the same request
                    // a second time. Configured prompts still seed the thread as before.
                    const triggerMessageId =
                        hasPromptOverride && run.triggerMessageId
                            ? run.triggerMessageId
                            : await postWorkflowStepPrompt(projectId, taskId, payerUserId, prompt)

                    const { generatePreConfigTaskResult } = require('../Assistant/assistantPreConfigTaskTopic')
                    await generatePreConfigTaskResult(
                        // The workflow task records the project member who created it and pays the Gold.
                        payerUserId,
                        projectId,
                        taskId,
                        followerIds,
                        isPublicFor,
                        assistantId,
                        prompt,
                        payer.exists ? payer.data().language || 'en' : 'en',
                        // null lets the assistant's own model/temperature/instructions/tools apply.
                        null,
                        { name: task.extendedName || task.name },
                        null,
                        'tasks',
                        // Grounds the run in the task it is about; see postWorkflowStepPrompt.
                        // The wall clock is the scheduled one, not the interactive 55 minutes: this
                        // run executes inside runWorkflowAiStepsSecondGen, whose Cloud Scheduler
                        // attempt deadline is 30 minutes.
                        { triggerMessageId, maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS }
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
            const awaitingAssistantRunIds = await findActiveAssistantRuns(projectId, taskId)
            if (awaitingAssistantRunIds.length > 0) {
                await parkWorkflowAiRunForExecution(runRef, runId, taskId, {
                    assistantRunIds: awaitingAssistantRunIds,
                })
                return
            }
            const awaitingCorrelationIds = await findUnsettledVmJobs(projectId, taskId)
            if (awaitingCorrelationIds.length > 0) {
                await parkWorkflowAiRunForExecution(runRef, runId, taskId, {
                    vmCorrelationIds: awaitingCorrelationIds,
                })
                return
            }
        }

        await finalizeWorkflowAiRun(runId, run, workflow, failureReason)
    } finally {
        await releaseAssistantTaskRunLock(taskRunLock.lockRef, runId)
    }
}

const parkWorkflowAiRunForExecution = async (
    runRef,
    runId,
    taskId,
    { assistantRunIds = [], vmCorrelationIds = [] },
    skipReason = null
) => {
    const now = Date.now()
    await runRef.set(buildAwaitingExecutionFields({ assistantRunIds, vmCorrelationIds, skipReason, now }), {
        merge: true,
    })
    const persistedRun = (await runRef.get()).data() || {}
    await setTaskWorkflowAiStatus(persistedRun.projectId, taskId, runId, persistedRun.stepId, RUN_STATUS_AWAITING_VM)
    console.log('[workflowAiStep] Holding the step until task assistant work finishes', {
        runId,
        taskId,
        assistantRunIds,
        vmCorrelationIds,
    })
}

/**
 * Moves the task off the step and settles the run. Split out of runWorkflowAiStep because a run that
 * dispatched VM work reaches this point later, from resolveAwaitingVmRuns.
 *
 * `recoveredByCorrelationId` reopens an already-failed run exactly once, for the case in
 * recoverWorkflowStepAfterVmSuccess: the work the step asked for did finish, just under a later VM
 * job than the one this run had parked on.
 */
const finalizeWorkflowAiRun = async (runId, run, workflow, failureReason, skipReason = null, options = {}) => {
    const { projectId, taskId, stepId } = run
    const { recoveredByCorrelationId = null } = options
    const db = admin.firestore()
    const taskRef = db.doc(`items/${projectId}/tasks/${taskId}`)
    const runRef = db.doc(`${RUNS_COLLECTION}/${runId}`)
    const settledAt = Date.now()
    const settledStatus = skipReason ? RUN_STATUS_SKIPPED : failureReason ? RUN_STATUS_FAILED : RUN_STATUS_COMPLETED

    // Firestore update triggers are at-least-once, and the minute poller can overlap an immediate
    // terminal-event resolver. Settle the run and move the task in one transaction so only one
    // invocation can win. Re-reading the task in that same transaction also preserves "whoever
    // moved it last wins" when the assistant or a human changed the step while work was running.
    const result = await db.runTransaction(async transaction => {
        const [runSnapshot, latestDoc] = await Promise.all([transaction.get(runRef), transaction.get(taskRef)])
        const persistedRun = runSnapshot.exists ? runSnapshot.data() || {} : null
        if (persistedRun && RUN_TERMINAL_STATUSES.includes(persistedRun.status)) {
            // A failed run may be reopened, but only by a recovery and only once. The stamp is what
            // makes that one-shot: a redelivered VM completion finds it already set. `completed` and
            // `skipped` runs already moved the task and are never reopened.
            const reopening =
                recoveredByCorrelationId &&
                persistedRun.status === RUN_STATUS_FAILED &&
                !persistedRun.recoveredByCorrelationId
            if (!reopening) return { finalized: false, moved: false }
        }

        const latest = latestDoc.exists ? { ...latestDoc.data(), id: taskId } : null
        const transition =
            !failureReason && latest && getCurrentStepId(latest) === stepId
                ? buildWorkflowStepAdvanceUpdate(latest, stepId, workflow)
                : null
        const workflowAiStatus = {
            runId,
            stepId,
            status: settledStatus,
            failureReason: failureReason || null,
            updatedAt: settledAt,
        }

        if (transition) {
            const { movingToDone, updateData } = transition
            transaction.set(taskRef, { ...updateData, workflowAiStatus }, { merge: true })

            const subtaskIds = Array.isArray(latest.subtaskIds) ? latest.subtaskIds : []
            subtaskIds.forEach(subtaskId => {
                transaction.set(
                    db.doc(`items/${projectId}/tasks/${subtaskId}`),
                    { ...updateData, parentDone: movingToDone, inDone: movingToDone },
                    { merge: true }
                )
            })
        } else if (latest) transaction.set(taskRef, { workflowAiStatus }, { merge: true })

        transaction.set(
            runRef,
            {
                status: settledStatus,
                ...(skipReason ? { reason: skipReason } : {}),
                ...(failureReason ? { failureReason } : {}),
                ...(recoveredByCorrelationId ? { recoveredByCorrelationId, recoveredAt: settledAt } : {}),
                settledAt,
            },
            { merge: true }
        )

        return { finalized: true, moved: !!transition, latest, transition }
    })

    if (!result.finalized) return false

    if (result.moved) {
        await writeMovedInWorkflowFeed(
            projectId,
            taskId,
            result.latest,
            workflow[stepId],
            result.transition.nextStepId,
            workflow
        )
        console.log('[workflowAiStep] Advanced task', {
            projectId,
            taskId,
            fromStepId: stepId,
            nextStepId: result.transition.nextStepId,
        })
    } else if (failureReason && result.latest && getCurrentStepId(result.latest) === stepId) {
        console.warn('[workflowAiStep] Run failed; leaving task on the assistant step', {
            runId,
            taskId,
            stepId,
            failureReason,
        })
    } else if (result.latest && getCurrentStepId(result.latest) === stepId) {
        console.warn('[workflowAiStep] Step vanished from the workflow, leaving task in place', {
            projectId,
            taskId,
            fromStepId: stepId,
        })
    } else {
        console.log('[workflowAiStep] Task already moved on, skipping advance', { runId, taskId })
    }

    return true
}

/**
 * Returns whether another authoritative AI execution mechanism is still active on this task.
 *
 * The task-level lock handles new comment/workflow races atomically. These collection checks cover
 * VM jobs (which can outlive the prompt that launched them) and interactive locks written by an
 * older function instance during a rolling deployment.
 */
const hasActiveAiTaskJob = async (projectId, taskId, now = Date.now()) =>
    (await findLiveTaskAiWork(projectId, taskId, now)).isLive

/**
 * Non-terminal chat assistant executions associated with this task.
 *
 * These locks are created when askToBotSecondGen starts, before the assistant selects and executes
 * execute_task_in_vm. That ordering is the important bridge between a chat request and its later VM
 * record. Workflow-owned runs do not create message locks, so this cannot make a workflow wait on
 * its own invocation.
 */
const findActiveAssistantRuns = async (projectId, taskId, now = Date.now()) => {
    try {
        const snapshot = await admin.firestore().collection('assistantRunLocks').where('objectId', '==', taskId).get()

        return snapshot.docs
            .filter(doc => {
                const run = doc.data() || {}
                return (
                    run.projectId === projectId &&
                    (run.objectType || 'tasks') === 'tasks' &&
                    ACTIVE_ASSISTANT_RUN_STATUSES.includes(run.status) &&
                    Number(run.lockExpiresAt || 0) > now
                )
            })
            .map(doc => doc.id)
    } catch (error) {
        console.warn('[workflowAiStep] Could not check for assistant runs, advancing', {
            taskId,
            error: error.message,
        })
        return []
    }
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

const findTerminalVmFailure = async (projectId, taskId, run = {}) => {
    try {
        const snapshot = await admin.firestore().collection('pendingWebhooks').where('objectId', '==', taskId).get()
        const correlationIds = new Set(run.awaitingCorrelationIds || [])
        const runStartedAt = Number(run.startedAt || run.createdAt || run.awaitingSince || 0)
        const failedJob = snapshot.docs.find(doc => {
            const job = doc.data() || {}
            const belongsToRun = correlationIds.has(doc.id) || Number(job.createdAt || 0) >= runStartedAt
            return (
                belongsToRun &&
                job.kind === 'vm_job' &&
                job.projectId === projectId &&
                (job.objectType || 'tasks') === 'tasks' &&
                ['failed', 'cancelled'].includes(job.status)
            )
        })
        return failedJob ? `vm_${failedJob.data().status}` : null
    } catch (error) {
        console.warn('[workflowAiStep] Could not check terminal VM outcome', { taskId, error: error.message })
        return null
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
                createdAt: Number(job.createdAt) || 0,
                expiresAt: Number(job.expiresAt) || 0,
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
    const vmExpiresAt = unsettledJobs.reduce((latest, job) => Math.max(latest, job.expiresAt), 0)
    const vmCreatedDeadline = unsettledJobs.reduce(
        (latest, job) => Math.max(latest, job.createdAt ? job.createdAt + AWAITING_VM_TIMEOUT_MS : 0),
        0
    )

    return Math.max(
        base,
        vmExpiresAt ? vmExpiresAt + VM_JOB_FINALIZATION_HEADROOM_MS : 0,
        vmCreatedDeadline,
        interactionExpiresAt ? interactionExpiresAt + AWAITING_VM_TIMEOUT_MS : 0
    )
}

/**
 * Advances runs that were parked waiting on VM work, once that work settles.
 *
 * Successful VM completion advances the workflow. Failures, cancellations, and timeouts settle the
 * run as failed while leaving the task on the assistant step for a deliberate retry.
 */
const resolveAwaitingVmRuns = async ({ now = Date.now(), projectId = null, taskId = null } = {}) => {
    let query = admin.firestore().collection(RUNS_COLLECTION)
    if (taskId) {
        // A terminal event knows the task but not necessarily the workflow run id: the run can park
        // in the pre-VM assistant phase before the VM correlation id exists. taskId has an automatic
        // single-field index, avoiding a new composite index for status + taskId.
        query = query.where('taskId', '==', taskId)
    } else {
        query = query.where('status', '==', RUN_STATUS_AWAITING_VM).limit(MAX_RUNS_PER_TICK)
    }
    const snapshot = await query.get()

    if (snapshot.empty) return 0

    let resolved = 0
    for (const doc of snapshot.docs) {
        const run = doc.data() || {}
        if (
            run.status !== RUN_STATUS_AWAITING_VM ||
            (projectId && run.projectId !== projectId) ||
            (taskId && run.taskId !== taskId)
        ) {
            continue
        }
        try {
            // Read the lifecycle phases in order, not in parallel. startVmJob persists its VM record
            // before the chat run can mark its assistantRunLock terminal. Therefore an active first
            // read can safely defer the VM read to the assistant/VM terminal event (or recovery
            // tick), while a terminal first read guarantees any dispatched VM is already queryable.
            // Parallel reads could straddle those writes in the opposite order and briefly see
            // neither blocker.
            const activeAssistantRunIds = run.awaitingAnyTaskExecution
                ? await findActiveAssistantRuns(run.projectId, run.taskId, now)
                : []
            const assistantTimedOut = activeAssistantRunIds.length > 0 && now >= resolveAwaitingDeadline(run, [])
            if (activeAssistantRunIds.length > 0 && !assistantTimedOut) continue

            const correlationIds = run.awaitingAnyTaskVm
                ? await findUnsettledVmJobs(run.projectId, run.taskId)
                : run.awaitingCorrelationIds
            const stillRunning = await filterUnsettledVmJobs(correlationIds)
            const timedOut = now >= resolveAwaitingDeadline(run, stillRunning)
            if ((activeAssistantRunIds.length > 0 || stillRunning.length > 0) && !timedOut) continue

            const workflow = await loadRunWorkflow(run)
            const timedOutWithActiveExecution =
                timedOut && (activeAssistantRunIds.length > 0 || stillRunning.length > 0)
            const terminalFailureReason = timedOutWithActiveExecution
                ? 'vm_timeout'
                : await findTerminalVmFailure(run.projectId, run.taskId, run)

            const finalized = await finalizeWorkflowAiRun(
                doc.id,
                run,
                workflow,
                terminalFailureReason,
                terminalFailureReason ? null : run.awaitingSkipReason || null
            )
            if (!finalized) continue
            resolved++
            console.log('[workflowAiStep] Assistant workflow run settled', {
                runId: doc.id,
                taskId: run.taskId,
                timedOut,
                outcome: terminalFailureReason ? 'failed' : 'advanced',
            })
        } catch (error) {
            console.error('[workflowAiStep] Could not resolve awaiting run', { runId: doc.id, error: error.message })
        }
    }

    return resolved
}

/**
 * Completes an AI step whose run already failed, when a later VM job finished its work.
 *
 * A run is bound to the VM job it parked on. If that job dies — a rate-limited agent, a crashed
 * sandbox — the run settles `failed` and the task correctly stays on the step. But the natural way
 * to retry is to start another VM task in the same thread, and that job belongs to no run: when it
 * succeeds and opens its Merge Request, there is nothing left to move the task on, so a finished
 * step sits there looking unfinished.
 *
 * Until AT-2188 this was invisible, because a VM agent's *question* performed a full forward move on
 * its own — any retry that asked anything advanced the workflow whether or not the work succeeded.
 * Removing that (correctly) exposed the gap underneath it.
 *
 * Deliberately narrow. Only a job that (a) genuinely succeeded, (b) started after the step failed,
 * so it is a retry rather than work the failed settlement already accounted for, and (c) belongs to
 * a task still sitting on that same failed step, can complete it. `recoveredByCorrelationId` on the
 * run and the step identity check in finalizeWorkflowAiRun each independently cap this at one
 * advance.
 */
const recoverWorkflowStepAfterVmSuccess = async job => {
    const projectId = job.projectId
    const taskId = job.objectId
    const db = admin.firestore()

    try {
        const taskDoc = await db.doc(`items/${projectId}/tasks/${taskId}`).get()
        if (!taskDoc.exists) return 0
        const task = { ...taskDoc.data(), id: taskId }

        // workflowAiStatus is the task's own pointer at the run that owns its current step, kept up
        // to date by every settlement. It saves querying workflowAiRuns for a failed run.
        const status = task.workflowAiStatus
        const stepId = getCurrentStepId(task)
        if (!stepId || !status || status.status !== RUN_STATUS_FAILED || !status.runId) return 0
        if (status.stepId !== stepId) return 0

        const runDoc = await db.doc(`${RUNS_COLLECTION}/${status.runId}`).get()
        if (!runDoc.exists) return 0
        const run = runDoc.data() || {}
        if (run.status !== RUN_STATUS_FAILED || run.recoveredByCorrelationId) return 0
        if (run.projectId !== projectId || run.taskId !== taskId || run.stepId !== stepId) return 0

        // Work that was already in flight when the step failed was weighed by that settlement.
        // Only something started afterwards is a retry of it.
        if (Number(job.createdAt || 0) < (Number(run.settledAt) || 0)) return 0

        const workflow = await loadRunWorkflow(run)
        if (!isAiWorkflowStep(workflow[stepId])) return 0

        const finalized = await finalizeWorkflowAiRun(status.runId, run, workflow, null, null, {
            recoveredByCorrelationId: job.correlationId || job.id || 'vm_job',
        })
        if (!finalized) return 0

        console.log('[workflowAiStep] Completed a failed step from a later successful VM job', {
            runId: status.runId,
            taskId,
            stepId,
            correlationId: job.correlationId,
        })
        return 1
    } catch (error) {
        console.error('[workflowAiStep] Could not recover the step after a successful VM job', {
            taskId,
            error: error.message,
        })
        return 0
    }
}

/**
 * Immediately re-check a parked workflow when its task VM enters a terminal state.
 *
 * The VM runner invokes this after result delivery, billing/refunds and its terminal status write.
 * finalizeWorkflowAiRun is the idempotency boundary against a runner retry racing the minute poller.
 */
const resolveWorkflowRunsForSettledVmJob = async (job = {}, now = Date.now()) => {
    if (
        !VM_TERMINAL_STATUSES.includes(job.status) ||
        job.kind !== 'vm_job' ||
        (job.objectType || 'tasks') !== 'tasks' ||
        !job.projectId ||
        !job.objectId
    ) {
        return 0
    }

    const resolved = await resolveAwaitingVmRuns({ now, projectId: job.projectId, taskId: job.objectId })
    // Only a fallback: a parked run that just moved the task has already taken this step's advance.
    if (resolved > 0 || job.status !== 'completed') return resolved

    return recoverWorkflowStepAfterVmSuccess(job)
}

/**
 * Close the pre-VM ordering window immediately as well.
 *
 * A workflow can park while a chat assistant run is still creating its VM record. Whichever
 * terminal event arrives last — the assistant lock or the VM job — performs the authoritative
 * re-check, so neither ordering falls back to the next minute tick.
 */
const resolveWorkflowRunsForAssistantRunUpdate = async (before = {}, after = {}, now = Date.now()) => {
    const wasActive = ACTIVE_ASSISTANT_RUN_STATUSES.includes(before.status)
    const isActive = ACTIVE_ASSISTANT_RUN_STATUSES.includes(after.status)
    if (!wasActive || isActive || (after.objectType || 'tasks') !== 'tasks' || !after.projectId || !after.objectId) {
        return 0
    }

    return resolveAwaitingVmRuns({ now, projectId: after.projectId, taskId: after.objectId })
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
    // Recovery path for a runner that died after persisting terminal state but before its direct
    // completion handoff, and for bounded timeout handling.
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
                    const workflow = await loadRunWorkflow(run)
                    await finalizeWorkflowAiRun(doc.id, run, workflow, 'stalled')
                }
            }
            const latestRun = await doc.ref.get()
            if (!latestRun.exists || !RUN_TERMINAL_STATUSES.includes(latestRun.data()?.status)) {
                await doc.ref.set(
                    { status: RUN_STATUS_FAILED, failureReason: 'stalled', settledAt: Date.now() },
                    { merge: true }
                )
            }
        } catch (error) {
            console.error('[workflowAiStep] Could not sweep stalled run', { runId: doc.id, error: error.message })
        }
    }

    console.log('[workflowAiStep] Swept stalled runs', { count: stalled.size })
    return stalled.size
}

const retryFailedWorkflowAiRun = async (projectId, taskId) => {
    const taskDoc = await admin.firestore().doc(`items/${projectId}/tasks/${taskId}`).get()
    if (!taskDoc.exists) throw new Error('Task not found')

    const task = { ...taskDoc.data(), id: taskId }
    if (task.workflowAiStatus?.status !== RUN_STATUS_FAILED) {
        throw new Error('Only failed assistant workflow runs can be retried')
    }

    const stepHistory = Array.isArray(task.stepHistory) ? task.stepHistory : []
    const stepId = getCurrentStepId(task)
    if (!stepId) throw new Error('Task is not on a workflow step')

    return enqueueWorkflowAiRunIfNeeded(
        projectId,
        taskId,
        { ...task, stepHistory: stepHistory.slice(0, -1) },
        { ...task, completed: Date.now(), workflowAiStatus: null }
    )
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
    recoverWorkflowStepAfterVmSuccess,
    resolveAwaitingVmRuns,
    resolveWorkflowRunsForAssistantRunUpdate,
    resolveWorkflowRunsForSettledVmJob,
    retryFailedWorkflowAiRun,
    runWorkflowAiStep,
    sweepStalledWorkflowAiRuns,
}
