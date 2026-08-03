import { translate } from '../../i18n/TranslationService'
import { getWorkflowStepsIdsSorted } from '../../utils/workflowOrder'
import { DONE_STEP, OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import { WORKFLOW_BACKWARD, WORKFLOW_FORWARD } from './workflowDirections'

const getWorkflowStepId = (stepIndex, stepIds) => {
    return stepIndex === OPEN_STEP || stepIndex === DONE_STEP ? stepIndex : stepIds[stepIndex]
}

export const getWorkflowTargetStepIndex = (direction, selectedNextStep, selectedPreviousStep) => {
    if (direction !== WORKFLOW_BACKWARD) return selectedNextStep

    // A deleted current step cannot be located when the modal initializes. Preserve the previous
    // safe behavior for that legacy state instead of trying to move to an undefined workflow step.
    return Number.isInteger(selectedPreviousStep) ? selectedPreviousStep : OPEN_STEP
}

export const getWorkflowStepName = (workflow, stepId) => {
    if (stepId === OPEN_STEP) return translate('Open')
    if (stepId === DONE_STEP) return translate('Done')
    return workflow?.[stepId]?.description
}

export const getWorkflowTargetStepNames = (workflow, selectedNextStep, selectedPreviousStep) => {
    const stepIds = getWorkflowStepsIdsSorted(workflow)
    const backwardStepIndex = getWorkflowTargetStepIndex(WORKFLOW_BACKWARD, selectedNextStep, selectedPreviousStep)
    const forwardStepIndex = getWorkflowTargetStepIndex(WORKFLOW_FORWARD, selectedNextStep, selectedPreviousStep)

    return {
        backwardStepName: getWorkflowStepName(workflow, getWorkflowStepId(backwardStepIndex, stepIds)),
        forwardStepName: getWorkflowStepName(workflow, getWorkflowStepId(forwardStepIndex, stepIds)),
    }
}
