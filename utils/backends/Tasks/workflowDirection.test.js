jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    OPEN_STEP: -1,
    DONE_STEP: -2,
}))

jest.mock('../../HelperFunctions', () => ({
    chronoEntriesOrder: jest.requireActual('../../workflowOrder').compareWorkflowEntries,
}))

import { DEFAULT_IS_FORWARD, getStepWorkflowDirection } from './workflowDirection'

const OPEN_STEP = -1
const DONE_STEP = -2

// Deliberately not in key order, the helper is expected to sort chronologically first.
const workflow = {
    'step-3': { description: 'Release', reviewerUid: 'user-3' },
    'step-1': { description: 'Design', reviewerUid: 'user-1' },
    'step-2': { description: 'Review', reviewerUid: 'user-2' },
}

const taskOn = stepId => ({ stepHistory: [OPEN_STEP, stepId] })

describe('getStepWorkflowDirection', () => {
    it('reports a move to Open as backward', () => {
        expect(getStepWorkflowDirection('open', taskOn('step-2'), workflow)).toBe(false)
    })

    it('reports a move to Done as forward', () => {
        expect(getStepWorkflowDirection('done', taskOn('step-2'), workflow)).toBe(true)
    })

    it('reports a move out of Open as forward', () => {
        expect(getStepWorkflowDirection('step-2', { stepHistory: [OPEN_STEP] }, workflow)).toBe(true)
    })

    it('reports a move out of Done as backward', () => {
        expect(getStepWorkflowDirection('step-2', { stepHistory: [OPEN_STEP, DONE_STEP] }, workflow)).toBe(false)
    })

    it('reports a move to a later step as forward', () => {
        expect(getStepWorkflowDirection('step-3', taskOn('step-1'), workflow)).toBe(true)
    })

    it('reports a move to an earlier step as backward', () => {
        expect(getStepWorkflowDirection('step-1', taskOn('step-3'), workflow)).toBe(false)
    })

    it('uses the reordered workflow when determining direction', () => {
        const reorderedWorkflow = {
            'step-1': { ...workflow['step-1'], sortIndex: 2 },
            'step-2': { ...workflow['step-2'], sortIndex: 1 },
            'step-3': { ...workflow['step-3'], sortIndex: 0 },
        }

        expect(getStepWorkflowDirection('step-1', taskOn('step-3'), reorderedWorkflow)).toBe(true)
        expect(getStepWorkflowDirection('step-3', taskOn('step-1'), reorderedWorkflow)).toBe(false)
    })

    it('falls back to the default direction when neither step is in the workflow', () => {
        // Both steps were deleted from the workflow while the task still referenced them.
        // Before the bounds check was fixed this walked past the end of the entries and threw.
        expect(getStepWorkflowDirection('deleted-target', taskOn('deleted-current'), workflow)).toBe(DEFAULT_IS_FORWARD)
    })

    it('resolves the direction from whichever of the two steps is still in the workflow', () => {
        expect(getStepWorkflowDirection('step-2', taskOn('deleted-current'), { 'step-2': workflow['step-2'] })).toBe(
            false
        )
        expect(getStepWorkflowDirection('deleted-target', taskOn('step-2'), { 'step-2': workflow['step-2'] })).toBe(
            true
        )
    })

    it('falls back to the default direction for an empty or missing workflow', () => {
        expect(getStepWorkflowDirection('step-1', taskOn('step-2'), {})).toBe(DEFAULT_IS_FORWARD)
        expect(getStepWorkflowDirection('step-1', taskOn('step-2'), undefined)).toBe(DEFAULT_IS_FORWARD)
    })

    it('always returns a boolean so feeds never persist a sentinel value', () => {
        const cases = [
            ['open', taskOn('step-2'), workflow],
            ['done', taskOn('step-2'), workflow],
            ['step-3', taskOn('step-1'), workflow],
            ['gone', taskOn('gone-too'), workflow],
            ['step-1', {}, workflow],
            ['step-1', undefined, undefined],
        ]

        cases.forEach(([targetStepId, task, steps]) => {
            expect(typeof getStepWorkflowDirection(targetStepId, task, steps)).toBe('boolean')
        })
    })
})
