import {
    publishProjectTaskCompletion,
    publishProjectTaskPostpone,
    resetProjectTaskCompletionListeners,
    subscribeToProjectTaskCompletions,
} from './projectTaskCompletionSignal'

describe('projectTaskCompletionSignal (AT-2558)', () => {
    beforeEach(() => {
        resetProjectTaskCompletionListeners()
    })

    it('delivers only to the completed task project', () => {
        const projectA = jest.fn()
        const projectB = jest.fn()
        subscribeToProjectTaskCompletions('p1', projectA)
        subscribeToProjectTaskCompletions('p2', projectB)

        publishProjectTaskCompletion({ projectId: 'p1', taskId: 't1' })

        expect(projectA).toHaveBeenCalledWith({ projectId: 'p1', taskId: 't1' })
        expect(projectB).not.toHaveBeenCalled()
    })

    it('delivers a qualifying postpone through the same project-scoped channel', () => {
        const projectA = jest.fn()
        const projectB = jest.fn()
        subscribeToProjectTaskCompletions('p1', projectA)
        subscribeToProjectTaskCompletions('p2', projectB)

        publishProjectTaskPostpone({ projectId: 'p1', taskId: 't1' })

        expect(projectA).toHaveBeenCalledWith({ projectId: 'p1', taskId: 't1' })
        expect(projectB).not.toHaveBeenCalled()
    })

    it('stops delivering after unsubscribe', () => {
        const listener = jest.fn()
        const unsubscribe = subscribeToProjectTaskCompletions('p1', listener)

        unsubscribe()
        unsubscribe()
        publishProjectTaskCompletion({ projectId: 'p1', taskId: 't1' })

        expect(listener).not.toHaveBeenCalled()
    })

    it.each([
        ['no project', { taskId: 't1' }],
        ['no task', { projectId: 'p1' }],
        ['nothing', undefined],
    ])('ignores an event with %s', (_label, event) => {
        const listener = jest.fn()
        subscribeToProjectTaskCompletions('p1', listener)

        publishProjectTaskCompletion(event)

        expect(listener).not.toHaveBeenCalled()
    })

    it('cannot let a broken animation listener abort task completion', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const healthy = jest.fn()
        subscribeToProjectTaskCompletions('p1', () => {
            throw new Error('boom')
        })
        subscribeToProjectTaskCompletions('p1', healthy)

        expect(() => publishProjectTaskCompletion({ projectId: 'p1', taskId: 't1' })).not.toThrow()
        expect(healthy).toHaveBeenCalledTimes(1)

        warn.mockRestore()
    })
})
