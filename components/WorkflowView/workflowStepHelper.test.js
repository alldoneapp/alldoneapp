import { getNextWorkflowStep, isNextWorkflowStepAi } from './workflowStepHelper'
import { getWorkflowSortIndexUpdates, getWorkflowStepsIdsSorted } from '../../utils/workflowOrder'

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

    test('uses persisted workflow order without changing step identities', () => {
        const reorderedWorkflow = {
            '2026-01': { ...workflow['2026-01'], sortIndex: 1 },
            '2026-02': { ...workflow['2026-02'], sortIndex: 0 },
        }

        expect(getWorkflowStepsIdsSorted(reorderedWorkflow)).toEqual(['2026-02', '2026-01'])
        expect(getNextWorkflowStep(reorderedWorkflow, { done: false, stepHistory: [-1] })).toBe(
            reorderedWorkflow['2026-02']
        )
        expect(getNextWorkflowStep(reorderedWorkflow, { done: false, stepHistory: [-1, '2026-02'] })).toBe(
            reorderedWorkflow['2026-01']
        )
    })

    test('places new legacy-positioned steps after explicitly ordered steps', () => {
        expect(
            getWorkflowStepsIdsSorted({
                '2026-01': { sortIndex: 0 },
                '2026-02': { sortIndex: 1 },
                '2026-03': {},
            })
        ).toEqual(['2026-01', '2026-02', '2026-03'])
    })

    test('builds one atomic user update for the complete reordered workflow', () => {
        expect(getWorkflowSortIndexUpdates('project-1', ['step-2', 'step-1'])).toEqual({
            'workflow.project-1.step-2.sortIndex': 0,
            'workflow.project-1.step-1.sortIndex': 1,
        })
    })
})
