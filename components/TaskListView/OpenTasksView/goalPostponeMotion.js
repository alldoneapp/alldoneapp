import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'
import {
    POSTPONE_COLLAPSE_MS,
    POSTPONE_EXIT_TOTAL_MS,
    POSTPONE_REDUCED_FADE_MS,
    POSTPONE_SLIDE_FADE_MS,
    POSTPONE_TRANSLATE_X,
    targetLeavesToday,
} from '../TaskItem/TaskPresentation/taskPostponeMotion'

/**
 * AT-2541 — the whole-section counterpart of `taskPostponeMotion`.
 *
 * A goal's swipe popup is mounted globally, while the thing that must move is the already rendered
 * goal row plus every task, control and spacer below it. The registry gives that popup a short-lived
 * handle to the section without putting animation state in Redux or rebuilding every goal row.
 *
 * The write deliberately starts after the exit has collapsed. That keeps the measured section in
 * the tree for the complete run, prevents live task snapshots from tearing rows out halfway through,
 * and gives a rejected write one stable section to restore.
 */

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'
const motionByGoal = new Map()
const listeners = new Set()
// Kept out of the small per-hook run-id range used by completion exits; the general-section entry
// consumes both kinds and must never mistake a new postpone for a previously played completion.
let nextRunId = 1000000

const keyFor = (projectId, goalId) => `${projectId}:${goalId}`

const registerGoalPostponeMotion = (projectId, goalId, begin) => {
    if (!projectId || !goalId || typeof begin !== 'function') return () => {}
    const key = keyFor(projectId, goalId)
    motionByGoal.set(key, begin)
    return () => {
        if (motionByGoal.get(key) === begin) motionByGoal.delete(key)
    }
}

export const subscribeToGoalPostponeMotion = listener => {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
}

const publishMotionState = event => {
    Array.from(listeners).forEach(listener => {
        try {
            listener(event)
        } catch (error) {
            console.warn('[goal postpone motion] listener failed', error)
        }
    })
}

export const postponeGoalWithMotion = async ({ projectId, goal, targetDate }, write) => {
    const begin = motionByGoal.get(keyFor(projectId, goal?.id))
    const run =
        targetLeavesToday(targetDate) && typeof begin === 'function'
            ? begin()
            : { settled: () => Promise.resolve(), cancel: () => {} }
    const runId = run.revealReplacement ? ++nextRunId : 0
    if (runId) publishMotionState({ projectId, goalId: goal.id, runId, active: true })

    try {
        await run.settled()
        const result = await write()
        if (runId) publishMotionState({ projectId, goalId: goal.id, runId, active: false })
        return result
    } catch (error) {
        run.cancel()
        if (runId) publishMotionState({ projectId, goalId: goal.id, runId, active: false })
        throw error
    }
}

export default function useGoalPostponeMotion({ enabled = false, projectId, goalId, sectionGap = 0 } = {}) {
    const reducedMotion = useReducedMotion()
    const [exiting, setExiting] = useState(false)
    const [exitHeight, setExitHeight] = useState(0)

    const translateX = useRef(new Animated.Value(0)).current
    const opacity = useRef(new Animated.Value(1)).current
    const height = useRef(new Animated.Value(0)).current
    const marginBottom = useRef(new Animated.Value(0)).current
    const measuredHeightRef = useRef(0)
    const animationRef = useRef(null)
    const exitingRef = useRef(false)
    const mountedRef = useRef(true)

    const onSectionLayout = useCallback(event => {
        const measured = event?.nativeEvent?.layout?.height
        if (measured > 0 && !exitingRef.current) measuredHeightRef.current = measured
    }, [])

    const reset = useCallback(() => {
        animationRef.current?.stop()
        animationRef.current = null
        translateX.setValue(0)
        opacity.setValue(1)
        height.setValue(0)
        marginBottom.setValue(0)
        exitingRef.current = false
        if (mountedRef.current) {
            setExitHeight(0)
            setExiting(false)
        }
    }, [height, marginBottom, opacity, translateX])

    const begin = useCallback(() => {
        if (!enabled || exitingRef.current || animationsAreDisabled()) {
            return { settled: () => Promise.resolve(), cancel: () => {} }
        }

        exitingRef.current = true
        setExiting(true)
        translateX.setValue(0)
        opacity.setValue(1)

        const measured = measuredHeightRef.current
        height.setValue(measured)
        marginBottom.setValue(sectionGap)
        setExitHeight(measured)

        let animation
        let holdMs
        if (reducedMotion) {
            animation = Animated.timing(opacity, {
                toValue: 0,
                duration: POSTPONE_REDUCED_FADE_MS,
                easing: Easing.out(Easing.quad),
                useNativeDriver: false,
            })
            holdMs = POSTPONE_REDUCED_FADE_MS
        } else {
            animation = Animated.sequence([
                Animated.parallel([
                    Animated.timing(translateX, {
                        toValue: POSTPONE_TRANSLATE_X,
                        duration: POSTPONE_SLIDE_FADE_MS,
                        easing: Easing.in(Easing.cubic),
                        useNativeDriver: false,
                    }),
                    Animated.timing(opacity, {
                        toValue: 0,
                        duration: POSTPONE_SLIDE_FADE_MS,
                        easing: Easing.in(Easing.quad),
                        useNativeDriver: false,
                    }),
                ]),
                ...(measured > 0 || sectionGap > 0
                    ? [
                          Animated.parallel([
                              ...(measured > 0
                                  ? [
                                        Animated.timing(height, {
                                            toValue: 0,
                                            duration: POSTPONE_COLLAPSE_MS,
                                            easing: Easing.inOut(Easing.cubic),
                                            useNativeDriver: false,
                                        }),
                                    ]
                                  : []),
                              ...(sectionGap > 0
                                  ? [
                                        Animated.timing(marginBottom, {
                                            toValue: 0,
                                            duration: POSTPONE_COLLAPSE_MS,
                                            easing: Easing.inOut(Easing.cubic),
                                            useNativeDriver: false,
                                        }),
                                    ]
                                  : []),
                          ]),
                      ]
                    : []),
            ])
            holdMs = POSTPONE_EXIT_TOTAL_MS
        }

        animationRef.current = animation
        animation.start()
        const startedAt = Date.now()
        let cancelled = false

        return {
            started: true,
            // Reduced motion explicitly avoids animated layout changes. Let the normal list update
            // introduce any replacement only after the brief fade instead of expanding it beside
            // a still-full-height goal section.
            revealReplacement: !reducedMotion,
            settled: () => {
                const remaining = holdMs - (Date.now() - startedAt)
                return remaining > 0 ? new Promise(resolve => setTimeout(resolve, remaining)) : Promise.resolve()
            },
            cancel: () => {
                if (cancelled) return
                cancelled = true
                reset()
            },
        }
    }, [enabled, height, marginBottom, opacity, reducedMotion, reset, sectionGap, translateX])

    useEffect(() => {
        if (!enabled) return undefined
        return registerGoalPostponeMotion(projectId, goalId, begin)
    }, [begin, enabled, goalId, projectId])

    useEffect(
        () => () => {
            mountedRef.current = false
            animationRef.current?.stop()
            animationRef.current = null
        },
        []
    )

    const sectionStyle = useMemo(() => {
        if (!exiting) return undefined
        const style = { opacity, pointerEvents: 'none' }
        if (!reducedMotion) {
            style.transform = [{ translateX }]
            if (exitHeight > 0) {
                style.height = height
                style.minHeight = 0
                style.overflow = 'hidden'
            }
            if (sectionGap > 0) style.marginBottom = marginBottom
        }
        return style
    }, [exitHeight, exiting, height, marginBottom, opacity, reducedMotion, sectionGap, translateX])

    return { onSectionLayout, sectionStyle, exiting }
}

/** Test seam. */
export const resetGoalPostponeMotionRegistry = () => {
    motionByGoal.clear()
    listeners.clear()
    nextRunId = 1000000
}
