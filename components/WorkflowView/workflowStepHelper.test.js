import { getNextWorkflowStep, isNextWorkflowStepAi } from './workflowStepHelper'

const workflow = {
    '2026-01': { description: 'Human review', reviewerType: null },
    '2026-02': { description: 'AI draft', reviewerType: 'assistant' },
}

describe('next workflow step presentation', () => {
    test('uses the first step for an open task', () => {
        expect(getNextWorkflowStep(workflow, { done: false, stepHistory: [-1] })).toBe(workflow['2026-01'])
        expect(isNextWorkflowStepAi(workflow, { done: false, stepHistory: [-1] })).toBe(false)
        expect(
            isNextWorkflowStepAi(
                { '2026-01': { description: 'AI draft', reviewerType: 'assistant' } },
                { done: false, stepHistory: [-1] }
            )
        ).toBe(true)
    })

    test('recognizes an AI step after the current human step', () => {
        expect(isNextWorkflowStepAi(workflow, { done: false, stepHistory: [-1, '2026-01'] })).toBe(true)
    })

    test('has no next workflow step after the final or completed step', () => {
        expect(getNextWorkflowStep(workflow, { done: false, stepHistory: [-1, '2026-02'] })).toBeNull()
        expect(getNextWorkflowStep(workflow, { done: true, stepHistory: [-1] })).toBeNull()
    })
})
