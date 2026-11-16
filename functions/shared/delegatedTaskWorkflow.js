// Pure task-specific workflow rules, shared by the server and the web client. Saved user
// workflows are never modified when a request is delegated.
const DELEGATION_REVIEW_STEP = '~delegation-review'

const isDelegatedWorkflowTask = task =>
    task?.executionMode !== 'direct' &&
    task?.taskMetadata?.delegation?.ownerId === task?.userId &&
    task?.taskMetadata?.delegation?.requiresReview === true

const withDelegationReviewStep = (workflow = {}, task, reviewDescription = 'Review result') => {
    if (!isDelegatedWorkflowTask(task)) return workflow
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
        result[DELEGATION_REVIEW_STEP] = {
            reviewerUid: task.userId,
            reviewerType: 'user',
            description: reviewDescription,
            sortIndex: steps.length,
        }
    }
    return result
}

module.exports = { DELEGATION_REVIEW_STEP, isDelegatedWorkflowTask, withDelegationReviewStep }
