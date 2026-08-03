import { getWorkflowStepName, getWorkflowTargetStepIndex, getWorkflowTargetStepNames } from './workflowNavigation'

jest.mock('../TaskListView/Utils/TasksHelper', () => ({ OPEN_STEP: -1, DONE_STEP: -2 }))

const workflow = {
    step1: { description: 'First review', sortIndex: 0 },
    step2: { description: 'Second review', sortIndex: 1 },
}

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

    it('names both destinations from the first workflow step', () => {
        expect(getWorkflowTargetStepNames(workflow, 1, -1)).toEqual({
            backwardStepName: 'Open',
            forwardStepName: 'Second review',
        })
    })

    it('names Done as the forward destination from the last workflow step', () => {
        expect(getWorkflowTargetStepNames(workflow, -2, 0)).toEqual({
            backwardStepName: 'First review',
            forwardStepName: 'Done',
        })
    })

    it('uses the selected custom workflow step name', () => {
        expect(getWorkflowTargetStepNames(workflow, 0, -1).forwardStepName).toBe('First review')
    })

    it('returns no name for a workflow step that no longer exists', () => {
        expect(getWorkflowStepName(workflow, 'deleted-step')).toBeUndefined()
    })
})
