// Helpers for AI workflow steps.
//
// A workflow step lives at users/{uid}.workflow[projectId][stepId]. Historically it only ever
// pointed at a human (`reviewerUid`). A step whose `reviewerType` is REVIEWER_TYPE_ASSISTANT points
// at an assistant instead: when a task lands on it, the stored prompt is run against the task in
// its own chat and the task then moves on to the next step by itself.
//
// NOTE: the server mirrors this logic in functions/Tasks/workflowStepHelper.js — Cloud Functions
// cannot import from outside functions/. Keep the two in sync.

export const REVIEWER_TYPE_ASSISTANT = 'assistant'

export const isAiWorkflowStep = step => !!step && step.reviewerType === REVIEWER_TYPE_ASSISTANT

// Returns the step selected by the workflow's default forward action. Open tasks enter the first
// step; tasks already in review advance from the last step recorded in their history.
export const getNextWorkflowStep = (workflow, task) => {
    if (!workflow || !task || task.done) return null

    const stepIds = Object.keys(workflow).sort()
    if (stepIds.length === 0) return null

    const currentStepId = task.stepHistory?.[task.stepHistory.length - 1]
    const currentStepIndex = stepIds.indexOf(currentStepId)
    const nextStepId = currentStepIndex === -1 ? stepIds[0] : stepIds[currentStepIndex + 1]

    return nextStepId ? workflow[nextStepId] : null
}

export const isNextWorkflowStepAi = (workflow, task) => isAiWorkflowStep(getNextWorkflowStep(workflow, task))

// Cleared whenever a step stops pointing at a given assistant, so a step never keeps a prompt that
// belongs to a different assistant (or to no assistant at all).
export const emptyAiStepFields = () => ({
    reviewerType: null,
    aiPreConfigTaskId: null,
    aiActionName: '',
    aiPrompt: '',
    aiVariableValues: {},
})

// Pre-config prompts use the same `$name` placeholder convention as PreConfigTaskModal. A workflow
// run has no human to fill them in, so the values are captured when the step is configured.
export const buildAiStepPrompt = step => {
    if (!step || !step.aiPrompt) return ''

    const values = step.aiVariableValues || {}
    return Object.keys(values).reduce(
        (prompt, name) => prompt.replaceAll(`$${name}`, values[name] != null ? String(values[name]) : ''),
        step.aiPrompt
    )
}

// True when the two steps differ in anything the AI step editor can change. Used by EditStep to
// decide whether "save" should be enabled.
export const aiStepFieldsChanged = (a = {}, b = {}) => {
    if ((a.reviewerType || null) !== (b.reviewerType || null)) return true
    if ((a.aiPreConfigTaskId || null) !== (b.aiPreConfigTaskId || null)) return true
    if ((a.aiActionName || '') !== (b.aiActionName || '')) return true
    if ((a.aiPrompt || '') !== (b.aiPrompt || '')) return true

    const aValues = a.aiVariableValues || {}
    const bValues = b.aiVariableValues || {}
    const names = new Set([...Object.keys(aValues), ...Object.keys(bValues)])
    for (const name of names) {
        if ((aValues[name] || '') !== (bValues[name] || '')) return true
    }
    return false
}
