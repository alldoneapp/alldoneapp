import { buildTaskStateUndoOperation, buildTaskStateUndoOperations } from './taskStateUndo'

describe('task state undo operations', () => {
    it('captures the complete prior state when checking off a task', () => {
        const operation = buildTaskStateUndoOperation(
            'project-1',
            'task-1',
            {
                done: false,
                inDone: false,
                currentReviewerId: 'owner-1',
                stepHistory: ['open'],
                sortIndex: 10,
            },
            {
                done: true,
                inDone: true,
                currentReviewerId: 'done',
                completed: 2000,
                completedTime: { startTime: 1000, endTime: 2000 },
                sortIndex: 20,
            }
        )

        expect(operation).toMatchObject({
            objectType: 'task',
            projectId: 'project-1',
            objectId: 'task-1',
            before: {
                done: false,
                inDone: false,
                currentReviewerId: 'owner-1',
                sortIndex: 10,
            },
            beforeMissingFields: ['completed', 'completedTime'],
            after: {
                done: true,
                inDone: true,
                currentReviewerId: 'done',
                completed: 2000,
                completedTime: { startTime: 1000, endTime: 2000 },
                sortIndex: 20,
            },
        })
    })

    it('restores the exact previous workflow step and reviewer metadata', () => {
        const [operation] = buildTaskStateUndoOperations(
            'project-1',
            {
                'task-1': {
                    userIds: ['owner-1', 'reviewer-1'],
                    stepHistory: ['open', 'step-1'],
                    currentReviewerId: 'reviewer-1',
                    completed: 1000,
                    dueDate: 900,
                },
            },
            [
                {
                    taskId: 'task-1',
                    afterChanges: {
                        userIds: ['owner-1', 'reviewer-1', 'reviewer-2'],
                        stepHistory: ['open', 'step-1', 'step-2'],
                        currentReviewerId: 'reviewer-2',
                        completed: 2000,
                        dueDate: 2000,
                    },
                },
            ]
        )

        expect(operation.before).toEqual({
            userIds: ['owner-1', 'reviewer-1'],
            stepHistory: ['open', 'step-1'],
            currentReviewerId: 'reviewer-1',
            completed: 1000,
            dueDate: 900,
        })
        expect(operation.after).toEqual({
            userIds: ['owner-1', 'reviewer-1', 'reviewer-2'],
            stepHistory: ['open', 'step-1', 'step-2'],
            currentReviewerId: 'reviewer-2',
            completed: 2000,
            dueDate: 2000,
        })
    })

    it('records a deleted completion timestamp when reopening a task', () => {
        const operation = buildTaskStateUndoOperation(
            'project-1',
            'task-1',
            { done: true, completed: 2000 },
            { done: false },
            ['completed']
        )

        expect(operation.before).toEqual({ done: true, completed: 2000 })
        expect(operation.after).toEqual({ done: false })
        expect(operation.afterMissingFields).toEqual(['completed'])
    })
})
