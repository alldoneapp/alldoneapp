jest.mock('../Utils/HelperFunctionsCloud', () => ({ DONE_STEP: -2 }))

const { DONE_STEP } = require('../Utils/HelperFunctionsCloud')
const { getNextWorkflowStepId, getSortedWorkflowStepIds } = require('./workflowStepHelper')

describe('workflow step ordering', () => {
    test('uses legacy key order when no explicit positions exist', () => {
        const workflow = { 'step-2': {}, 'step-1': {} }

        expect(getSortedWorkflowStepIds(workflow)).toEqual(['step-1', 'step-2'])
    })

    test('uses persisted positions for automatic workflow advancement', () => {
        const workflow = {
            'step-1': { sortIndex: 1 },
            'step-2': { sortIndex: 0 },
            'step-3': {},
        }

        expect(getSortedWorkflowStepIds(workflow)).toEqual(['step-2', 'step-1', 'step-3'])
        expect(getNextWorkflowStepId(workflow, 'step-2')).toBe('step-1')
        expect(getNextWorkflowStepId(workflow, 'step-3')).toBe(DONE_STEP)
    })
})
