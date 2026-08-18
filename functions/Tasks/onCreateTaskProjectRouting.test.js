'use strict'

/**
 * AT-2306 — how automatic project selection is sequenced inside the task-create
 * fan-out. Both properties below are invisible in normal use and destructive
 * when wrong, which is why they are pinned here rather than left to the comment.
 */

const order = []

const mockRouteNewTaskToProject = jest.fn(async () => ({ action: 'skipped' }))
const mockRouteNewTaskToGoal = jest.fn(async () => ({ action: 'skipped' }))

jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({})) }))
jest.mock('../Goals/goalsFirestore', () => ({
    updateGoalDynamicProgress: jest.fn(),
    updateGoalEditionData: jest.fn(),
}))
jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    TASKS_OBJECTS_TYPE: 'tasks',
    createRecord: jest.fn(async () => order.push('algolia')),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ checkIfObjectIsLocked: jest.fn(async () => false) }))
jest.mock('../Firestore/contactsFirestore', () => ({
    updateContactOpenTasksAmount: jest.fn(async () => order.push('contactCount')),
}))
jest.mock('../shared/taskIdGenerator', () => ({ getNextTaskId: jest.fn(async () => null) }))
jest.mock('./taskGoalRouting', () => ({
    routeNewTaskToGoal: (...args) => {
        order.push('goalRouting')
        return mockRouteNewTaskToGoal(...args)
    },
}))
jest.mock('./taskProjectRouting', () => ({
    routeNewTaskToProject: (...args) => {
        order.push('projectRouting')
        return mockRouteNewTaskToProject(...args)
    },
}))
jest.mock('./workflowAiStep', () => ({ enqueueWorkflowAiRunIfNeeded: jest.fn(async () => {}) }))

const { onCreateTask } = require('./onCreateTaskFunctions')

const task = { id: 'task1', name: 'Fix the scroll bug', userId: 'user1', humanReadableId: 'AT-1' }

describe('onCreateTask project routing order', () => {
    beforeEach(() => {
        order.length = 0
        jest.clearAllMocks()
        mockRouteNewTaskToProject.mockResolvedValue({ action: 'skipped' })
        mockRouteNewTaskToGoal.mockResolvedValue({ action: 'skipped' })
    })

    // The router MOVES the task, which deletes this project's document. Anything
    // still writing to it (Algolia, the contact count, the human-readable id)
    // has to be finished first.
    it('routes only after the rest of the create fan-out has finished', async () => {
        await onCreateTask(task, 'project1')

        expect(order.indexOf('algolia')).toBeGreaterThanOrEqual(0)
        expect(order.indexOf('contactCount')).toBeGreaterThanOrEqual(0)
        expect(order.indexOf('projectRouting')).toBeGreaterThan(order.indexOf('algolia'))
        expect(order.indexOf('projectRouting')).toBeGreaterThan(order.indexOf('contactCount'))
    })

    it('still routes the goal for a task that stays in its project', async () => {
        await onCreateTask(task, 'project1')

        expect(mockRouteNewTaskToGoal).toHaveBeenCalledWith({ task, projectId: 'project1' })
        expect(order.indexOf('goalRouting')).toBeGreaterThan(order.indexOf('projectRouting'))
    })

    // Goals are project-local: assigning one here would be nulled by the move.
    it('skips goal routing for a task that was moved to another project', async () => {
        mockRouteNewTaskToProject.mockResolvedValue({ action: 'moved', targetProjectId: 'project2' })

        await onCreateTask(task, 'project1')

        expect(mockRouteNewTaskToGoal).not.toHaveBeenCalled()
    })

    it('does not lose goal routing when project routing throws', async () => {
        mockRouteNewTaskToProject.mockRejectedValue(new Error('classifier exploded'))

        await onCreateTask(task, 'project1')

        expect(mockRouteNewTaskToGoal).toHaveBeenCalled()
    })
})
