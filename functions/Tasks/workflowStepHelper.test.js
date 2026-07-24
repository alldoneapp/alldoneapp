jest.mock('../Utils/HelperFunctionsCloud', () => ({ DONE_STEP: -2 }))

const { DONE_STEP } = require('../Utils/HelperFunctionsCloud')
const {
    buildWorkflowStepAdvanceUpdate,
    getNextWorkflowStepId,
    getSortedWorkflowStepIds,
} = require('./workflowStepHelper')

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

describe('workflow step advance update', () => {
    const workflow = {
        ai: { reviewerUid: 'assistant', sortIndex: 0 },
        review: { reviewerUid: 'human', sortIndex: 1 },
    }

    test('builds the standard fields for the next workflow step', () => {
        expect(
            buildWorkflowStepAdvanceUpdate(
                {
                    userId: 'owner',
                    userIds: ['owner', 'assistant'],
                    stepHistory: [-1, 'ai'],
                },
                'ai',
                workflow,
                123
            )
        ).toEqual({
            nextStepId: 'review',
            movingToDone: false,
            updateData: {
                userIds: ['owner', 'assistant', 'human'],
                currentReviewerId: 'human',
                stepHistory: [-1, 'ai', 'review'],
                completed: 123,
                dueDate: 123,
                done: false,
                inDone: false,
                sortIndex: 123,
            },
        })
    })

    test('builds the normal Done fields after the last workflow step', () => {
        expect(
            buildWorkflowStepAdvanceUpdate(
                {
                    userId: 'owner',
                    userIds: ['owner', 'human'],
                    stepHistory: [-1, 'ai', 'review'],
                },
                'review',
                workflow,
                456
            )
        ).toEqual({
            nextStepId: -2,
            movingToDone: true,
            updateData: {
                userIds: ['owner'],
                currentReviewerId: -2,
                completed: 456,
                done: true,
                inDone: true,
                sortIndex: 456,
            },
        })
    })
})
