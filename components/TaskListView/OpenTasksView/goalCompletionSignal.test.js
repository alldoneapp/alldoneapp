import {
    publishGoalTaskCompletion,
    resetGoalTaskCompletionListeners,
    subscribeToGoalTaskCompletions,
} from './goalCompletionSignal'

/**
 * AT-2507 — the channel a completing task row uses to tell the goal section above it.
 *
 * The two cases that carry real risk are at the bottom. A listener here is called from inside
 * `beginCompletionMotion`, whose return value is how long the row holds its Firestore write — so a
 * listener that throws, or one that unsubscribes itself mid-dispatch (a goal section that has just
 * decided it is done is a very likely candidate), must not be able to take the completion down
 * with it or silently skip the next subscriber.
 */
describe('goalCompletionSignal (AT-2507)', () => {
    beforeEach(() => {
        resetGoalTaskCompletionListeners()
    })

    const event = { projectId: 'p1', goalId: 'g1', taskId: 't1' }

    it('delivers a completion to every subscriber', () => {
        const first = jest.fn()
        const second = jest.fn()
        subscribeToGoalTaskCompletions(first)
        subscribeToGoalTaskCompletions(second)

        publishGoalTaskCompletion(event)

        expect(first).toHaveBeenCalledWith(event)
        expect(second).toHaveBeenCalledWith(event)
    })

    it('stops delivering once unsubscribed', () => {
        const listener = jest.fn()
        const unsubscribe = subscribeToGoalTaskCompletions(listener)

        unsubscribe()
        publishGoalTaskCompletion(event)

        expect(listener).not.toHaveBeenCalled()
    })

    it('survives being unsubscribed twice', () => {
        const unsubscribe = subscribeToGoalTaskCompletions(jest.fn())
        unsubscribe()
        expect(unsubscribe).not.toThrow()
    })

    it.each([
        ['no project', { goalId: 'g1', taskId: 't1' }],
        ['no goal', { projectId: 'p1', taskId: 't1' }],
        ['no task', { projectId: 'p1', goalId: 'g1' }],
        ['nothing at all', undefined],
    ])('publishes nothing for an event with %s', (_label, incomplete) => {
        const listener = jest.fn()
        subscribeToGoalTaskCompletions(listener)

        publishGoalTaskCompletion(incomplete)

        expect(listener).not.toHaveBeenCalled()
    })

    it('keeps delivering when a listener unsubscribes from inside its own callback', () => {
        const second = jest.fn()
        const unsubscribeFirst = subscribeToGoalTaskCompletions(() => unsubscribeFirst())
        subscribeToGoalTaskCompletions(second)

        publishGoalTaskCompletion(event)

        expect(second).toHaveBeenCalledWith(event)
    })

    it('never lets a broken listener abort the completion it is reporting', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const healthy = jest.fn()
        subscribeToGoalTaskCompletions(() => {
            throw new Error('boom')
        })
        subscribeToGoalTaskCompletions(healthy)

        // An exception escaping here would abort `beginCompletionMotion`, so the row would never
        // learn how long to hold its write and the task would never be written at all.
        expect(() => publishGoalTaskCompletion(event)).not.toThrow()
        expect(healthy).toHaveBeenCalledWith(event)

        warn.mockRestore()
    })

    it('ignores a subscriber that is not a function', () => {
        expect(() => subscribeToGoalTaskCompletions(undefined)()).not.toThrow()
    })
})
