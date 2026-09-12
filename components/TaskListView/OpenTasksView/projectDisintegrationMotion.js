import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { DISINTEGRATION_DURATION_MS } from './projectLineDisintegration'

/** A small tail keeps the board's unmount from clipping the final dissolve frame. */
export const PROJECT_DISINTEGRATION_EXIT_HOLD_MS = DISINTEGRATION_DURATION_MS + 120

/**
 * If the board fails to unmount a card it decided to remove, restore it instead of leaving an
 * invisible, zero-height project in the tree. This mirrors the original AT-2495 backstop.
 */
export const PROJECT_DISINTEGRATION_RECOVERY_MS = PROJECT_DISINTEGRATION_EXIT_HOLD_MS + 400

/**
 * AT-2558 — drives the original AT-2495 right-to-left project-card disintegration without
 * reconnecting AT-2492's preceding FILL → SHIMMER → PULSE colour sweep.
 *
 * The pixels, dust, sparks and collapse all still derive from the same `Animated.Value`; this hook
 * changes only when that value starts. A run id means the board has already combined two facts: a
 * genuine top-level task completion or postpone was reported, and this exact project is now
 * leaving All Projects. The dissolve can therefore begin immediately and play exactly once.
 */
export default function useProjectDisintegrationMotion(runId, lineWillLeave = false, enabled = true) {
    const [exiting, setExiting] = useState(false)
    const disintegrate = useRef(new Animated.Value(0)).current
    const playedRunRef = useRef(0)

    const resetRun = useCallback(() => {
        setExiting(false)
        disintegrate.setValue(0)
    }, [disintegrate])

    useEffect(() => {
        if (!runId || !lineWillLeave || runId === playedRunRef.current || !enabled) return undefined

        playedRunRef.current = runId
        disintegrate.setValue(0)
        setExiting(true)

        const animation = Animated.timing(disintegrate, {
            toValue: 1,
            duration: DISINTEGRATION_DURATION_MS,
            // The dissolve front is a physical edge the eye follows. Easing makes it appear to
            // stall at the left side, so retain the original AT-2495 linear timing.
            easing: Easing.linear,
            useNativeDriver: false,
        })
        animation.start()

        const recoveryTimer = setTimeout(resetRun, PROJECT_DISINTEGRATION_RECOVERY_MS)
        return () => {
            clearTimeout(recoveryTimer)
            animation.stop()
        }
    }, [runId, lineWillLeave, enabled, disintegrate, resetRun])

    // Preserve AT-2495's recovery: if new work lands while the card is dissolving, the board keeps
    // the project and the effect must hand the complete, clickable card back immediately.
    useEffect(() => {
        if (exiting && (!lineWillLeave || !enabled)) resetRun()
    }, [exiting, lineWillLeave, enabled, resetRun])

    return {
        disintegrate,
        exiting: exiting && enabled,
        animated: enabled,
    }
}
