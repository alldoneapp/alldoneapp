import { completeTaskWithMotion, startTaskCompletionMotion } from './taskCompletionHandoff'

/**
 * AT-2495 — the rules the popup completion paths depend on.
 *
 * The defect this guards against is not "the animation looks wrong", it is "the write raced the
 * animation" and "the row was left collapsed after a failed write". Both are about ORDER, so every
 * assertion here is about when `write` is called relative to the hold and to `cancel`.
 */
describe('taskCompletionHandoff', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    const makeMotion = (holdMs = 1000) => {
        const begin = jest.fn(() => holdMs)
        const cancel = jest.fn()
        return { begin, cancel }
    }

    describe('startTaskCompletionMotion', () => {
        it('starts the row motion and reports it as a completion by default', () => {
            const motion = makeMotion()

            startTaskCompletionMotion(motion)

            expect(motion.begin).toHaveBeenCalledWith({ isCompletion: true })
        })

        it('forwards isCompletion so a workflow step advance is not celebrated', () => {
            const motion = makeMotion()

            startTaskCompletionMotion(motion, { isCompletion: false })

            expect(motion.begin).toHaveBeenCalledWith({ isCompletion: false })
        })

        it('holds for as long as the row asked for', async () => {
            const motion = makeMotion(1070)
            const run = startTaskCompletionMotion(motion)
            const settled = jest.fn()

            run.settled().then(settled)
            jest.advanceTimersByTime(1069)
            await Promise.resolve()
            expect(settled).not.toHaveBeenCalled()

            jest.advanceTimersByTime(1)
            await Promise.resolve()
            expect(settled).toHaveBeenCalled()
        })

        /**
         * The property that lets `FollowUpModal` start the animation BEFORE uploading the
         * attachments on its completion comment: work the caller does while the row is animating
         * is counted against the hold instead of being added to it.
         */
        it('counts work already done since the motion started against the hold', async () => {
            const motion = makeMotion(1000)
            const run = startTaskCompletionMotion(motion)
            const settled = jest.fn()

            // 400ms of the caller's own async work elapses before it is ready to write.
            jest.advanceTimersByTime(400)

            run.settled().then(settled)
            jest.advanceTimersByTime(599)
            await Promise.resolve()
            expect(settled).not.toHaveBeenCalled()

            jest.advanceTimersByTime(1)
            await Promise.resolve()
            expect(settled).toHaveBeenCalled()
        })

        it('does not wait at all when the caller already outlasted the animation', async () => {
            const motion = makeMotion(1000)
            const run = startTaskCompletionMotion(motion)

            jest.advanceTimersByTime(5000)

            // Resolves with no timer having to fire.
            await expect(run.settled()).resolves.toBeUndefined()
        })

        it('does not wait when the row answers a zero hold', async () => {
            const motion = makeMotion(0)
            const run = startTaskCompletionMotion(motion)

            await expect(run.settled()).resolves.toBeUndefined()
        })

        it('cancels the row motion at most once', () => {
            const motion = makeMotion()
            const run = startTaskCompletionMotion(motion)

            run.cancel()
            run.cancel()

            expect(motion.cancel).toHaveBeenCalledTimes(1)
        })

        /**
         * `TaskChatWorkflowControls` renders the same workflow controls in the task detailed view,
         * where there is no row. An inert run must write immediately, exactly as that surface does
         * today — not hold for a default duration and not throw.
         */
        it.each([
            ['undefined', undefined],
            ['null', null],
            ['an object with no begin', {}],
        ])('is inert when the motion is %s', async (_label, motion) => {
            const run = startTaskCompletionMotion(motion)

            await expect(run.settled()).resolves.toBeUndefined()
            expect(() => run.cancel()).not.toThrow()
        })

        it('is inert rather than hanging when the row answers a non-numeric hold', async () => {
            const run = startTaskCompletionMotion({ begin: () => undefined, cancel: jest.fn() })

            await expect(run.settled()).resolves.toBeUndefined()
        })
    })

    describe('completeTaskWithMotion', () => {
        it('writes only after the animation has had its run', async () => {
            const motion = makeMotion(1070)
            const write = jest.fn().mockResolvedValue('written')

            const pending = completeTaskWithMotion(motion, { isCompletion: true }, write)

            await Promise.resolve()
            expect(motion.begin).toHaveBeenCalled()
            expect(write).not.toHaveBeenCalled()

            jest.advanceTimersByTime(1070)
            await expect(pending).resolves.toBe('written')
            expect(write).toHaveBeenCalledTimes(1)
        })

        /**
         * The row has already collapsed to zero height by the time the write is attempted. Leaving
         * it there would be an invisible row in the list — the exact failure the subtask branch of
         * AT-2404 exists to avoid, arriving from a different direction.
         */
        it('puts the row back when the write fails, and rethrows', async () => {
            const motion = makeMotion(10)
            const failure = new Error('permission-denied')
            const write = jest.fn().mockRejectedValue(failure)

            const pending = completeTaskWithMotion(motion, { isCompletion: true }, write)
            jest.advanceTimersByTime(10)

            await expect(pending).rejects.toBe(failure)
            expect(motion.cancel).toHaveBeenCalledTimes(1)
        })

        it('leaves the row alone when the write succeeds', async () => {
            const motion = makeMotion(10)
            const pending = completeTaskWithMotion(motion, { isCompletion: true }, jest.fn())
            jest.advanceTimersByTime(10)

            await pending

            expect(motion.cancel).not.toHaveBeenCalled()
        })

        it('writes immediately with no motion available', async () => {
            const write = jest.fn().mockResolvedValue(undefined)

            await completeTaskWithMotion(undefined, { isCompletion: true }, write)

            expect(write).toHaveBeenCalledTimes(1)
        })
    })
})
