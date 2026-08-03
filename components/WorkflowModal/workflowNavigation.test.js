import { getWorkflowTargetStepIndex } from './workflowNavigation'

describe('getWorkflowTargetStepIndex', () => {
    it('moves send back to the immediately previous workflow step', () => {
        expect(getWorkflowTargetStepIndex('BACKWARD', 3, 1)).toBe(1)
    })

    it('moves send back to Open from the first workflow step', () => {
        expect(getWorkflowTargetStepIndex('BACKWARD', 1, -1)).toBe(-1)
    })

    it('falls back to Open when the current workflow step was deleted', () => {
        expect(getWorkflowTargetStepIndex('BACKWARD', '', '')).toBe(-1)
    })

    it('keeps the selected target for forward transitions', () => {
        expect(getWorkflowTargetStepIndex('FORWARD', 3, 1)).toBe(3)
    })
})
