import {
    buildCrossUserTaskStatisticsMarker,
    shouldClientWriteTaskTransitionStatistics,
} from './taskTransitionStatistics'

describe('task transition statistics ownership', () => {
    test('keeps an owner statistics write in the client batch', () => {
        expect(shouldClientWriteTaskTransitionStatistics('user-1', 'user-1')).toBe(true)
        expect(buildCrossUserTaskStatisticsMarker('user-1', 'user-1', 1000, () => 'transition-1')).toEqual({})
    })

    test('marks a reviewer transition for the server and removes its client statistics write', () => {
        expect(shouldClientWriteTaskTransitionStatistics('owner-1', 'reviewer-1')).toBe(false)
        expect(buildCrossUserTaskStatisticsMarker('owner-1', 'reviewer-1', 1000, () => 'transition-1')).toEqual({
            taskStatisticsTransition: {
                id: 'transition-1',
                actorId: 'reviewer-1',
                ownerId: 'owner-1',
                completed: 1000,
            },
        })
    })
})
