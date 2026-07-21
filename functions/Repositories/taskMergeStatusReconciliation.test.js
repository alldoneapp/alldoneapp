'use strict'

jest.mock('./mergeStatus', () => ({
    refreshTaskMergeStatus: jest.fn(() => Promise.resolve({ mergeRequest: { status: 'ready_to_merge' } })),
}))

const { refreshTaskMergeStatus } = require('./mergeStatus')
const {
    didWorkflowStepChange,
    reconcileTaskMergeStatusAfterWorkflowChange,
} = require('./taskMergeStatusReconciliation')

const mergeRequest = {
    provider: 'github',
    url: 'https://github.com/alldone/app/pull/12',
    status: 'checks_running',
    statusUpdatedAt: Date.now(),
}

describe('task merge status workflow reconciliation', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('recognizes moves between open, workflow, and done steps', () => {
        const open = { done: false, inDone: false, currentReviewerId: 'owner', stepHistory: [-1] }
        const review = {
            done: false,
            inDone: false,
            currentReviewerId: 'reviewer',
            stepHistory: [-1, 'review-step'],
        }
        const done = { ...review, done: true, inDone: true, currentReviewerId: -2 }

        expect(didWorkflowStepChange(open, review)).toBe(true)
        expect(didWorkflowStepChange(review, done)).toBe(true)
        expect(didWorkflowStepChange(done, open)).toBe(true)
    })

    test('recognizes different workflow steps assigned to the same reviewer', () => {
        const first = { currentReviewerId: 'reviewer', stepHistory: [-1, 'step-1'] }
        const second = { currentReviewerId: 'reviewer', stepHistory: [-1, 'step-1', 'step-2'] }

        expect(didWorkflowStepChange(first, second)).toBe(true)
    })

    test('ignores ordinary task and provider-status updates', () => {
        const oldTask = { currentReviewerId: 'reviewer', stepHistory: [-1, 'review-step'], name: 'Before' }
        const editedTask = { ...oldTask, name: 'After' }
        const refreshedTask = { ...editedTask, vmMergeRequest: { ...mergeRequest, status: 'ready_to_merge' } }

        expect(didWorkflowStepChange(oldTask, editedTask)).toBe(false)
        expect(didWorkflowStepChange(editedTask, refreshedTask)).toBe(false)
    })

    test('force-refreshes the provider status after a connected task changes workflow step', async () => {
        const oldTask = { currentReviewerId: 'owner', stepHistory: [-1] }
        const newTask = {
            ...oldTask,
            currentReviewerId: 'reviewer',
            stepHistory: [-1, 'review-step'],
            lastEditorId: 'editor-1',
            vmMergeRequest: mergeRequest,
        }

        await reconcileTaskMergeStatusAfterWorkflowChange({
            projectId: 'project-1',
            taskId: 'task-1',
            oldTask,
            newTask,
        })

        expect(refreshTaskMergeStatus).toHaveBeenCalledWith({
            userId: 'editor-1',
            projectId: 'project-1',
            taskId: 'task-1',
            force: true,
        })
    })

    test('does not refresh an unconnected task or a task whose workflow step did not change', async () => {
        const oldTask = { currentReviewerId: 'owner', stepHistory: [-1] }

        await reconcileTaskMergeStatusAfterWorkflowChange({
            projectId: 'project-1',
            taskId: 'task-1',
            oldTask,
            newTask: { ...oldTask, name: 'Edited' },
        })
        await reconcileTaskMergeStatusAfterWorkflowChange({
            projectId: 'project-1',
            taskId: 'task-1',
            oldTask,
            newTask: { ...oldTask, name: 'Edited', vmMergeRequest: mergeRequest },
        })

        expect(refreshTaskMergeStatus).not.toHaveBeenCalled()
    })

    test('keeps the workflow update successful when the provider refresh fails', async () => {
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {})
        refreshTaskMergeStatus.mockRejectedValueOnce(new Error('provider unavailable'))
        const oldTask = { currentReviewerId: 'owner', stepHistory: [-1] }
        const newTask = {
            ...oldTask,
            currentReviewerId: -2,
            done: true,
            inDone: true,
            vmMergeRequest: mergeRequest,
        }

        await expect(
            reconcileTaskMergeStatusAfterWorkflowChange({
                projectId: 'project-1',
                taskId: 'task-1',
                oldTask,
                newTask,
            })
        ).resolves.toBeNull()
        expect(warning).toHaveBeenCalled()
        warning.mockRestore()
    })
})
