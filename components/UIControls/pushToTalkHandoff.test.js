import { createPushToTalkHandoff } from './pushToTalkHandoff'

const RELEASE = { heldMs: 1200, releasedInside: true, cancelled: false, distance: 4 }

describe('pushToTalkHandoff (AT-2823)', () => {
    test('forwards moves and the release to the claimant', () => {
        const handoff = createPushToTalkHandoff({ origin: { clientX: 10, clientY: 20 } })
        const onMove = jest.fn()
        const onEnd = jest.fn()

        expect(handoff.origin).toEqual({ clientX: 10, clientY: 20 })
        handoff.claim({ onMove, onEnd })
        handoff.move({ dx: 1, dy: 0, distance: 1 })
        handoff.end(RELEASE)

        expect(onMove).toHaveBeenCalledWith({ dx: 1, dy: 0, distance: 1 })
        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd).toHaveBeenCalledWith(RELEASE)
        expect(handoff.isEnded()).toBe(true)
    })

    test('keeps the last move reported before the claim instead of forwarding it', () => {
        const handoff = createPushToTalkHandoff()
        handoff.move({ dx: 0, dy: -50, distance: 50 })
        const onMove = jest.fn()

        handoff.claim({ onMove, onEnd: jest.fn() })

        // The receiver applies it itself once it has started, so it is not delivered twice.
        expect(onMove).not.toHaveBeenCalled()
        expect(handoff.getLastMove()).toEqual({ dx: 0, dy: -50, distance: 50 })
    })

    test('a release before the claim is delivered at claim time, exactly once', () => {
        const handoff = createPushToTalkHandoff()
        handoff.end(RELEASE)
        handoff.end({ ...RELEASE, cancelled: true })
        const onEnd = jest.fn()

        handoff.claim({ onEnd })

        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd).toHaveBeenCalledWith(RELEASE)
    })

    test('can only be claimed once, so one hold never opens the microphone twice', () => {
        const handoff = createPushToTalkHandoff()
        const first = jest.fn()
        const second = jest.fn()

        expect(handoff.claim({ onEnd: first })).toEqual(expect.any(Function))
        expect(handoff.claim({ onEnd: second })).toBeNull()
        handoff.end(RELEASE)

        expect(first).toHaveBeenCalledTimes(1)
        expect(second).not.toHaveBeenCalled()
    })

    test('a claimant that stopped listening (unmounted) receives nothing', () => {
        const handoff = createPushToTalkHandoff()
        const onEnd = jest.fn()
        const stop = handoff.claim({ onEnd })

        stop()
        handoff.end(RELEASE)

        expect(onEnd).not.toHaveBeenCalled()
    })
})
