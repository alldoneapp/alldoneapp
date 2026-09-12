import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useProjectDisintegrationMotion, {
    PROJECT_DISINTEGRATION_EXIT_HOLD_MS,
    PROJECT_DISINTEGRATION_RECOVERY_MS,
} from './projectDisintegrationMotion'
import { useProjectLineExit } from './projectCompletedSweepMotion'
import { DISINTEGRATION_DURATION_MS, DISSOLVE_MASK_IMAGE } from './projectLineDisintegration'

const CARD_HEIGHT = 240
let latest

const Harness = ({ runId = 0, lineWillLeave = false, enabled = true }) => {
    const motion = useProjectDisintegrationMotion(runId, lineWillLeave, enabled)
    const exit = useProjectLineExit(motion, 28)
    latest = { motion, exit }
    return null
}

describe('the direct project disintegration (AT-2558)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    const mountMeasuredCard = async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<Harness />)
        })
        await act(async () => {
            latest.exit.onLineLayout({ nativeEvent: { layout: { height: CARD_HEIGHT } } })
            tree.update(<Harness runId={1} lineWillLeave />)
        })
        return tree
    }

    it('starts the original mask exit immediately and only once per run', async () => {
        const tree = await mountMeasuredCard()

        expect(latest.motion.exiting).toBe(true)
        expect(latest.exit.exitStyle.maskImage).toBe(DISSOLVE_MASK_IMAGE)
        expect(latest.exit.exitHeight).toBe(CARD_HEIGHT)

        const progress = latest.motion.disintegrate
        await act(async () => tree.update(<Harness runId={1} lineWillLeave />))
        expect(latest.motion.disintegrate).toBe(progress)
        expect(latest.motion.exiting).toBe(true)
    })

    it('holds longer than the 1.2 second exit and restores an abandoned card', async () => {
        const tree = await mountMeasuredCard()

        expect(DISINTEGRATION_DURATION_MS).toBe(1200)
        expect(PROJECT_DISINTEGRATION_EXIT_HOLD_MS).toBeGreaterThan(DISINTEGRATION_DURATION_MS)
        expect(PROJECT_DISINTEGRATION_RECOVERY_MS).toBeGreaterThan(PROJECT_DISINTEGRATION_EXIT_HOLD_MS)

        await act(async () => jest.advanceTimersByTime(PROJECT_DISINTEGRATION_RECOVERY_MS + 1))
        expect(latest.motion.exiting).toBe(false)
        expect(latest.exit.exitStyle).toBeUndefined()
        tree.unmount()
    })

    it('restores immediately when the board withdraws its leaving verdict', async () => {
        const tree = await mountMeasuredCard()

        await act(async () => tree.update(<Harness runId={1} lineWillLeave={false} />))

        expect(latest.motion.exiting).toBe(false)
        expect(latest.exit.exitStyle).toBeUndefined()
        tree.unmount()
    })

    it('stands down completely when its shared motion gate is disabled', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<Harness runId={1} lineWillLeave enabled={false} />)
        })

        expect(latest.motion.exiting).toBe(false)
        expect(latest.exit.exitStyle).toBeUndefined()
        tree.unmount()
    })

    it('cancels an active exit when reduced motion is enabled mid-run', async () => {
        const tree = await mountMeasuredCard()

        await act(async () => tree.update(<Harness runId={1} lineWillLeave enabled={false} />))

        expect(latest.motion.exiting).toBe(false)
        expect(latest.exit.exitStyle).toBeUndefined()
        tree.unmount()
    })
})
