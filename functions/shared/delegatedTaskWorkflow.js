// Pure task-specific workflow rules, shared by the server and the web client. Saved user
// workflows are never modified when a request is delegated.
const DELEGATION_REVIEW_STEP = '~delegation-review'
// AT-3071: when the owner's saved workflow has no usable step for the responsible assistant, a
// delegated task runs its own two-step workflow instead of waiting for a choice: the assistant works
// on the request in the task, then the owner reviews. Nothing is written to the saved workflow.
const DELEGATION_WORK_STEP = '~delegation-work'
// The configured prompt of that work step. The first run is grounded by the request comment the
// task was created with (see runWorkflowAiStep); this text is only posted when the step runs again
// (sent back without a note, or the request comment is gone).
const DELEGATION_WORK_PROMPT =
    'Continue working on the request in this task conversation. Report the result here and leave the task open for review.'

const isDelegatedWorkflowTask = task =>
    task?.executionMode !== 'direct' &&
    task?.taskMetadata?.delegation?.ownerId === task?.userId &&
    task?.taskMetadata?.delegation?.requiresReview === true

const isDirectStartDelegation = task =>
    isDelegatedWorkflowTask(task) &&
    task.taskMetadata.delegation.directStart === true &&
    typeof task.taskMetadata.delegation.assistantId === 'string' &&
    !!task.taskMetadata.delegation.assistantId

const buildReviewStep = (task, reviewDescription, sortIndex) => ({
    reviewerUid: task.userId,
    reviewerType: 'user',
    description: reviewDescription,
    sortIndex,
})

const withDelegationReviewStep = (
    workflow = {},
    task,
    reviewDescription = 'Review result',
    workDescription = 'Work on request'
) => {
    if (!isDelegatedWorkflowTask(task)) return workflow
    // A direct start never used the saved workflow, so later edits to it do not change this task.
    if (isDirectStartDelegation(task)) {
        return {
            [DELEGATION_WORK_STEP]: {
                reviewerUid: task.taskMetadata.delegation.assistantId,
                reviewerType: 'assistant',
                description: workDescription,
                aiPrompt: DELEGATION_WORK_PROMPT,
                sortIndex: 0,
            },
            [DELEGATION_REVIEW_STEP]: buildReviewStep(task, reviewDescription, 1),
        }
    }
    if (!Object.keys(workflow || {}).length && !task.stepHistory?.includes(DELEGATION_REVIEW_STEP)) return workflow

    // Normalize the order on the returned copy so the review stays last even in legacy workflows
    // whose steps have no sortIndex. The caller's saved workflow remains untouched.
    const steps = Object.entries(workflow || {}).filter(([id]) => id !== DELEGATION_REVIEW_STEP)
    steps.sort(([aId, a], [bId, b]) => {
        const aOrdered = Number.isFinite(a.sortIndex)
        const bOrdered = Number.isFinite(b.sortIndex)
        if (aOrdered || bOrdered) {
            if (!aOrdered) return 1
            if (!bOrdered) return -1
            if (a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex
        }
        return aId < bId ? -1 : aId > bId ? 1 : 0
    })
    const result = Object.fromEntries(steps.map(([id, step], index) => [id, { ...step, sortIndex: index }]))
    const lastStep = steps[steps.length - 1]?.[1]
    if (
        task.stepHistory?.includes(DELEGATION_REVIEW_STEP) ||
        lastStep?.reviewerUid !== task.userId ||
        lastStep?.reviewerType === 'assistant'
    ) {
        result[DELEGATION_REVIEW_STEP] = buildReviewStep(task, reviewDescription, steps.length)
    }
    return result
}

module.exports = {
    DELEGATION_REVIEW_STEP,
    DELEGATION_WORK_STEP,
    DELEGATION_WORK_PROMPT,
    isDelegatedWorkflowTask,
    isDirectStartDelegation,
    withDelegationReviewStep,
}
