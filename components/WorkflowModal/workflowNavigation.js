export const getWorkflowTargetStepIndex = (direction, selectedNextStep, selectedPreviousStep) => {
    if (direction !== 'BACKWARD') return selectedNextStep

    // A deleted current step cannot be located when the modal initializes. Preserve the previous
    // safe behavior for that legacy state instead of trying to move to an undefined workflow step.
    return Number.isInteger(selectedPreviousStep) ? selectedPreviousStep : -1
}
