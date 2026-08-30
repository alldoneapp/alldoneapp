import {
    enqueueOpenTasksBackgroundHydration,
    OPEN_TASKS_BACKGROUND_HYDRATION_CONCURRENCY,
    resetOpenTasksBackgroundHydrationQueue,
} from './openTasksBackgroundQueue'

describe('open tasks background hydration queue', () => {
    beforeEach(resetOpenTasksBackgroundHydrationQueue)
    afterEach(resetOpenTasksBackgroundHydrationQueue)

    it('bounds complete task snapshots while foreground project discovery stays concurrent', () => {
        const starts = []
        const completions = []

        Array.from({ length: 5 }, (_, index) =>
            enqueueOpenTasksBackgroundHydration(done => {
                starts.push(index)
                completions[index] = done
            })
        )

        expect(starts).toEqual([0, 1])
        expect(starts).toHaveLength(OPEN_TASKS_BACKGROUND_HYDRATION_CONCURRENCY)

        completions[0]()
        expect(starts).toEqual([0, 1, 2])
        completions[1]()
        expect(starts).toEqual([0, 1, 2, 3])
    })

    it('removes a queued project when its board block unmounts', () => {
        const starts = []
        const completions = []
        enqueueOpenTasksBackgroundHydration(done => {
            starts.push('first')
            completions.push(done)
        })
        enqueueOpenTasksBackgroundHydration(done => {
            starts.push('second')
            completions.push(done)
        })
        const cancelThird = enqueueOpenTasksBackgroundHydration(() => starts.push('third'))

        cancelThird()
        completions[0]()
        completions[1]()

        expect(starts).toEqual(['first', 'second'])
    })

    it('releases an active slot when a running project unmounts', () => {
        const starts = []
        const cancelFirst = enqueueOpenTasksBackgroundHydration(() => starts.push('first'))
        enqueueOpenTasksBackgroundHydration(() => starts.push('second'))
        enqueueOpenTasksBackgroundHydration(() => starts.push('third'))

        expect(starts).toEqual(['first', 'second'])
        cancelFirst()

        expect(starts).toEqual(['first', 'second', 'third'])
    })
})
