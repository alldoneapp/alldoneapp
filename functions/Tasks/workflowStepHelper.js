// Server mirror of components/WorkflowView/workflowStepHelper.js.
//
// Cloud Functions cannot import from outside functions/, so the small amount of AI-workflow-step
// logic shared with the client is duplicated here. Keep the two in sync.

const { DONE_STEP } = require('../Utils/HelperFunctionsCloud')

const REVIEWER_TYPE_ASSISTANT = 'assistant'

const isAiWorkflowStep = step => !!step && step.reviewerType === REVIEWER_TYPE_ASSISTANT

// Legacy steps are ordered by their chronological push IDs. Once a workflow is reordered, each
// step receives a sortIndex. Missing sortIndex values (including newly-added steps) remain last.
const getSortedWorkflowStepIds = (workflow = {}) =>
    Object.entries(workflow)
        .sort((a, b) => {
            const aHasSortIndex = Number.isFinite(a[1] && a[1].sortIndex)
            const bHasSortIndex = Number.isFinite(b[1] && b[1].sortIndex)

            if (aHasSortIndex || bHasSortIndex) {
                if (!aHasSortIndex) return 1
                if (!bHasSortIndex) return -1
                if (a[1].sortIndex !== b[1].sortIndex) return a[1].sortIndex - b[1].sortIndex
            }

            return a[0] < b[0] ? -1 : 1
        })
        .map(([stepId]) => stepId)

/**
 * The step a task moves to when it leaves `stepId`. Returns DONE_STEP when `stepId` is the last
 * step, and null when `stepId` is not part of the workflow at all.
 */
const getNextWorkflowStepId = (workflow, stepId) => {
    const stepIds = getSortedWorkflowStepIds(workflow)
    const index = stepIds.indexOf(stepId)
    if (index === -1) return null

    return index + 1 < stepIds.length ? stepIds[index + 1] : DONE_STEP
}

/**
 * Pre-config prompts use `$name` placeholders that a human normally fills in right before running.
 * A workflow run is unattended, so the values were captured when the step was configured.
 */
const buildAiStepPrompt = (step, promptOverride) => {
    const prompt = promptOverride || (step && step.aiPrompt) || ''
    if (!prompt) return ''

    const values = (step && step.aiVariableValues) || {}
    return Object.keys(values).reduce(
        (result, name) => result.split(`$${name}`).join(values[name] != null ? String(values[name]) : ''),
        prompt
    )
}

module.exports = {
    REVIEWER_TYPE_ASSISTANT,
    isAiWorkflowStep,
    getSortedWorkflowStepIds,
    getNextWorkflowStepId,
    buildAiStepPrompt,
}
