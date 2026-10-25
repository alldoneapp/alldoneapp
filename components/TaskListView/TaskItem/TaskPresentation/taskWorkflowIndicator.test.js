import { shouldShowWorkflowIndicator } from './taskWorkflowIndicator'

const workflow = {
    '2026-01': { description: 'Review', reviewerUid: 'reviewer' },
}

const baseTask = { done: false, parentId: null, stepHistory: [-1] }

describe('workflow indicator on the task checkbox', () => {
    test('marks an open root task whose owner has a workflow', () => {
        expect(shouldShowWorkflowIndicator({ workflow: workflow, task: baseTask })).toBe(true)
        expect(
            shouldShowWorkflowIndicator({ workflow: workflow, task: { ...baseTask, executionMode: 'workflow' } })
        ).toBe(true)
    })

    test('shows the plain checkbox for a task set to go straight to Done', () => {
        expect(
            shouldShowWorkflowIndicator({ workflow: workflow, task: { ...baseTask, executionMode: 'direct' } })
        ).toBe(false)
    })

    test('shows the plain checkbox without a workflow, for subtasks and for done tasks', () => {
        expect(shouldShowWorkflowIndicator({ workflow: {}, task: baseTask })).toBe(false)
        expect(shouldShowWorkflowIndicator({ workflow: null, task: baseTask })).toBe(false)
        expect(shouldShowWorkflowIndicator({ workflow: workflow, task: { ...baseTask, parentId: 'parent' } })).toBe(
            false
        )
        expect(shouldShowWorkflowIndicator({ workflow: workflow, task: { ...baseTask, done: true } })).toBe(false)
    })
})
