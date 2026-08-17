/**
 * AT-2342 - the publish/subscribe bus that carries a just-created task to the live task
 * watchers before Firestore echoes it back.
 */
import {
    OPTIMISTIC_TASK_ADDED,
    OPTIMISTIC_TASK_REMOVED,
    buildOptimisticTaskChange,
    publishOptimisticTaskCreateFailed,
    publishOptimisticTaskCreated,
    resetOptimisticTaskCreates,
    subscribeToOptimisticTaskCreates,
} from './optimisticTaskCreate'

describe('optimistic task create bus', () => {
    beforeEach(() => resetOptimisticTaskCreates())

    it('delivers a created task to the subscribers of its project', () => {
        const received = []
        subscribeToOptimisticTaskCreates('project-1', change => received.push(change))

        publishOptimisticTaskCreated('project-1', 'task-1', { name: 'buy milk' })

        expect(received).toHaveLength(1)
        expect(received[0].type).toBe(OPTIMISTIC_TASK_ADDED)
        expect(received[0].doc.id).toBe('task-1')
        expect(received[0].doc.data()).toEqual({ name: 'buy milk' })
    })

    it('never leaks a task into another project', () => {
        const received = []
        subscribeToOptimisticTaskCreates('project-2', change => received.push(change))

        publishOptimisticTaskCreated('project-1', 'task-1', { name: 'buy milk' })

        expect(received).toHaveLength(0)
    })

    it('stops delivering once the watcher unsubscribes', () => {
        const received = []
        const unsubscribe = subscribeToOptimisticTaskCreates('project-1', change => received.push(change))

        unsubscribe()
        publishOptimisticTaskCreated('project-1', 'task-1', { name: 'buy milk' })

        expect(received).toHaveLength(0)
    })

    it('publishes a rollback when the write is rejected', () => {
        const received = []
        subscribeToOptimisticTaskCreates('project-1', change => received.push(change))

        publishOptimisticTaskCreateFailed('project-1', 'task-1', { name: 'buy milk' })

        expect(received[0].type).toBe(OPTIMISTIC_TASK_REMOVED)
        expect(received[0].doc.exists).toBe(false)
    })

    it('shapes the payload like a Firestore docChanges() entry, carrying the RAW document', () => {
        // The pipelines call mapTaskData(change.doc.id, change.doc.data()) themselves, so data()
        // must return exactly what .set() writes - an already-mapped task would be mapped twice.
        const raw = { name: 'buy milk', dueDate: 5, isPublicFor: [0] }
        const change = buildOptimisticTaskChange(OPTIMISTIC_TASK_ADDED, 'task-1', raw)

        expect(change.doc.data()).toBe(raw)
        expect(change.doc.metadata).toEqual({ fromCache: true, hasPendingWrites: true })
    })

    it('keeps publishing to healthy subscribers when one of them throws', () => {
        // One broken list must never take task creation down with it.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const received = []
        subscribeToOptimisticTaskCreates('project-1', () => {
            throw new Error('broken list')
        })
        subscribeToOptimisticTaskCreates('project-1', change => received.push(change))

        expect(() => publishOptimisticTaskCreated('project-1', 'task-1', { name: 'x' })).not.toThrow()
        expect(received).toHaveLength(1)
        warn.mockRestore()
    })

    it('tolerates a subscriber that unsubscribes while it is being notified', () => {
        const received = []
        const unsubscribeSecond = () => secondUnsubscribe()
        let secondUnsubscribe = () => {}

        subscribeToOptimisticTaskCreates('project-1', () => unsubscribeSecond())
        secondUnsubscribe = subscribeToOptimisticTaskCreates('project-1', change => received.push(change))

        expect(() => publishOptimisticTaskCreated('project-1', 'task-1', { name: 'x' })).not.toThrow()
    })

    it('ignores incomplete publications rather than emitting a broken change', () => {
        const received = []
        subscribeToOptimisticTaskCreates('project-1', change => received.push(change))

        publishOptimisticTaskCreated('project-1', '', { name: 'x' })
        publishOptimisticTaskCreated('project-1', 'task-1', null)
        publishOptimisticTaskCreated('', 'task-1', { name: 'x' })

        expect(received).toHaveLength(0)
    })
})
