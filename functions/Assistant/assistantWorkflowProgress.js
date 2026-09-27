const { FieldValue } = require('firebase-admin/firestore')

const INVALID_COMPACTION = 'INVALID_COMPACTION_ARGUMENTS'
const INCOMPLETE_WORKFLOW = 'ASSISTANT_WORKFLOW_INCOMPLETE'

function compactionArgumentError(message) {
    return Object.assign(new Error(message), { code: INVALID_COMPACTION })
}

function workflowStateRef(db, context) {
    const { projectId, objectType, objectId, assistantId } = context || {}
    return projectId && objectType && objectId && assistantId
        ? db.doc(`assistantThreadState/${projectId}_${objectType}_${objectId}_${assistantId}`)
        : null
}

async function readWorkflowState(db, context) {
    const ref = workflowStateRef(db, context)
    if (!ref) return {}
    const snapshot = await ref.get()
    return snapshot.exists ? snapshot.data() || {} : {}
}

async function recordProjectCatalog(db, context, projects) {
    if (!context?.trackWorkflowProgress) return
    const ref = workflowStateRef(db, context)
    if (ref) {
        await ref.set(
            { projectWorkflow: { catalog: projects.map(({ id, name }) => ({ id, name: name || id })) } },
            { merge: true }
        )
    }
}

// Written in the SAME batch as the description, before feed writes. A process exit must
// never leave a successful update without its receipt, or a receipt without the update.
function projectCompletionWrite(db, context, projectId) {
    if (!context?.trackWorkflowProgress) return null
    const ref = workflowStateRef(db, context)
    return ref ? { ref, data: { projectWorkflow: { completedIds: FieldValue.arrayUnion(projectId) } } } : null
}

function reconcileProjectWorkflow(state, { progressTotal, projectIds }) {
    // Interactive callers that did not opt into recording write receipts keep
    // their existing generic compaction behavior.
    if (!state.projectWorkflow) return null
    if (projectIds != null && (!Array.isArray(projectIds) || projectIds.some(id => typeof id !== 'string' || !id))) {
        throw compactionArgumentError('projectIds must be an array of project IDs, or null.')
    }
    const workflow = state.projectWorkflow
    if (!workflow?.completedIds?.length && !projectIds?.length) return null
    const catalogIds = (workflow?.catalog || []).map(project => project.id)
    const expectedIds = workflow?.expectedIds || projectIds || (catalogIds.length === progressTotal ? catalogIds : null)
    if (
        !Array.isArray(expectedIds) ||
        expectedIds.length !== progressTotal ||
        new Set(expectedIds).size !== progressTotal
    ) {
        throw compactionArgumentError(
            'Provide projectIds for every intended project in this batch; their count must equal progressTotal.'
        )
    }
    if (expectedIds.some(id => !catalogIds.includes(id))) {
        throw compactionArgumentError('Every projectId must come from get_user_projects. Read the project list first.')
    }
    if (projectIds && (projectIds.length !== expectedIds.length || projectIds.some(id => !expectedIds.includes(id)))) {
        throw compactionArgumentError('The project batch scope cannot change during a run.')
    }
    return { ...workflow, expectedIds }
}

function getWorkflowProgress(state = {}) {
    const workflow = state.projectWorkflow
    if (workflow?.expectedIds?.length) {
        const completed = new Set(workflow.completedIds || [])
        const pendingIds = workflow.expectedIds.filter(id => !completed.has(id))
        return {
            completed: workflow.expectedIds.length - pendingIds.length,
            total: workflow.expectedIds.length,
            pendingIds,
            next: pendingIds[0] || '',
            signature: workflow.expectedIds.filter(id => completed.has(id)).join(','),
        }
    }
    if (workflow?.completedIds?.length) {
        // A model that skips compaction altogether must not bypass the completion
        // check. Ask it to declare the ORIGINAL scope; never assume a catalog read
        // authorizes updating every returned project (it may only resolve one name).
        return {
            completed: 0,
            total: 1,
            scopePending: true,
            signature: workflow.completedIds.join(','),
        }
    }
    const completed = Number(state.progressCompleted)
    const total = Number(state.progressTotal)
    if (!Number.isInteger(completed) || !Number.isInteger(total) || total <= 0) return null
    return {
        completed,
        total,
        next: state.nextProjectId || state.nextProjectName || '',
        signature: `${completed}/${total}`,
    }
}

function getPendingWorkflowProgress(state, context) {
    // A rejected compaction is unfinished work even if it was meant to record the
    // last unit. Do not accept a final answer instead of the corrected tool call.
    if (context?.compactionRepairAttempts > 0) {
        return {
            completed: 0,
            total: 1,
            next: 'the corrected compact_thread_context call',
            signature: 'compaction-repair',
        }
    }
    return getWorkflowProgress(state)
}

function workflowContinuationMessage(progress) {
    if (progress.scopePending) {
        return (
            'Record the exact originally requested project-description scope with compact_thread_context before finishing. ' +
            'Read get_user_projects if needed, then supply projectIds for only the projects the user requested (all intended projects, completed and pending), progressCompleted and progressTotal. ' +
            'Do not expand a single-project request to the full catalog. Successful updates are already saved; do not repeat them. Continue any remaining authorized work after compaction.'
        )
    }
    return (
        `The original workflow is still incomplete: ${progress.completed}/${progress.total} units completed. ` +
        `Continue the original authorized task with ${progress.next || 'the next unfinished unit'} using the necessary tools. ` +
        'Compaction is only a checkpoint, not completion. Do not stop with a progress report or ask whether to continue. ' +
        'Do not repeat successfully completed writes. If genuinely blocked, explain the blocker; do not claim success.'
    )
}

function createWorkflowContinuationGuard() {
    let lastSignature = null
    let attempts = 0
    return progress => {
        if (!progress || progress.completed >= progress.total) return null
        if (progress.signature !== lastSignature) attempts = 0
        lastSignature = progress.signature
        if (++attempts > 2) {
            throw Object.assign(
                new Error(`Workflow stopped without progress at ${progress.completed}/${progress.total}.`),
                {
                    code: INCOMPLETE_WORKFLOW,
                }
            )
        }
        return workflowContinuationMessage(progress)
    }
}

async function executeWithCompactionRepair(context, toolName, execute) {
    try {
        const result = await execute()
        if (toolName === 'compact_thread_context' && context) context.compactionRepairAttempts = 0
        return result
    } catch (error) {
        if (
            toolName !== 'compact_thread_context' ||
            !(error.code === INVALID_COMPACTION || error instanceof SyntaxError)
        )
            throw error
        const attempts = (context?.compactionRepairAttempts || 0) + 1
        if (context) context.compactionRepairAttempts = attempts
        if (attempts > 2) throw error
        return {
            success: false,
            retryable: true,
            error: error.message,
            instruction:
                'Correct this compact_thread_context call and retry it. Supply a nonempty summary string and non-negative integers for progressCompleted and progressTotal. Preserve the original objective and do not repeat completed writes.',
        }
    }
}

async function assertWorkflowComplete(db, context, streamOutput = {}) {
    if (streamOutput.guardrailStopped) {
        throw Object.assign(new Error(streamOutput.guardrailStopped.message), { code: INCOMPLETE_WORKFLOW })
    }
    const progress = getPendingWorkflowProgress(await readWorkflowState(db, context), context)
    if (progress && progress.completed < progress.total) {
        throw Object.assign(
            new Error(
                progress.scopePending
                    ? 'Workflow incomplete: the intended project batch scope has not been recorded.'
                    : `Workflow incomplete: ${progress.completed}/${progress.total} units completed.`
            ),
            {
                code: INCOMPLETE_WORKFLOW,
            }
        )
    }
    return progress
}

module.exports = {
    compactionArgumentError,
    workflowStateRef,
    readWorkflowState,
    recordProjectCatalog,
    projectCompletionWrite,
    reconcileProjectWorkflow,
    getWorkflowProgress,
    getPendingWorkflowProgress,
    workflowContinuationMessage,
    createWorkflowContinuationGuard,
    executeWithCompactionRepair,
    assertWorkflowComplete,
}
