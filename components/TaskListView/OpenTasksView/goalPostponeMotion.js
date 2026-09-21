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
 * The write deliberately starts after the exit has finished. That keeps the section in the tree
 * for the complete run, prevents live task snapshots from tearing rows out halfway through, and
 * gives a rejected write one stable section to restore. Once the exit finishes, the section leaves
 * layout immediately while persistence continues. Keeping it mounted lets a rejected write restore
 * whatever the live list still contains. Layout dimensions are never animated.
 */

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'
const motionByGoal = new Map()

const keyFor = (projectId, goalId) => `${projectId}:${goalId}`

const registerGoalPostponeMotion = (projectId, goalId, begin) => {
    if (!projectId || !goalId || typeof begin !== 'function') return () => {}
    const key = keyFor(projectId, goalId)
    motionByGoal.set(key, begin)
    return () => {
        if (motionByGoal.get(key) === begin) motionByGoal.delete(key)
    }
}

export const postponeGoalWithMotion = async ({ projectId, goal, targetDate }, write) => {
    const begin = motionByGoal.get(keyFor(projectId, goal?.id))
    const run =
        targetLeavesToday(targetDate) && typeof begin === 'function'
            ? begin()
            : { settled: () => Promise.resolve(), cancel: () => {} }
    try {
        await run.settled()
        run.releaseSpace?.()
        return await write()
    } catch (error) {
        run.cancel()
        throw error
    }
}

export default function useGoalPostponeMotion({ enabled = false, projectId, goalId } = {}) {
    const reducedMotion = useReducedMotion()
    const [exiting, setExiting] = useState(false)
    const [spaceReleased, setSpaceReleased] = useState(false)

    const translateX = useRef(new Animated.Value(0)).current
    const opacity = useRef(new Animated.Value(1)).current
    const scaleY = useRef(new Animated.Value(1)).current
    const animationRef = useRef(null)
    const exitingRef = useRef(false)
    const mountedRef = useRef(true)

    const reset = useCallback(() => {
        animationRef.current?.stop()
        animationRef.current = null
        translateX.setValue(0)
        opacity.setValue(1)
        scaleY.setValue(1)
        exitingRef.current = false
        if (mountedRef.current) {
            setExiting(false)
            setSpaceReleased(false)
        }
    }, [opacity, scaleY, translateX])

    const begin = useCallback(() => {
        if (!enabled || exitingRef.current || animationsAreDisabled()) {
            return { settled: () => Promise.resolve(), cancel: () => {} }
        }

        exitingRef.current = true
        setExiting(true)
        translateX.setValue(0)
        opacity.setValue(1)
        scaleY.setValue(1)

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
                // Keep the slot stable during the motion, then release it once before writing.
                Animated.timing(scaleY, {
                    toValue: 0,
                    duration: POSTPONE_COLLAPSE_MS,
                    easing: Easing.inOut(Easing.cubic),
                    useNativeDriver: false,
                }),
            ])
            holdMs = POSTPONE_EXIT_TOTAL_MS
        }

        animationRef.current = animation
        animation.start()
        const startedAt = Date.now()
        let cancelled = false

        return {
            started: true,
            settled: () => {
                const remaining = holdMs - (Date.now() - startedAt)
                return remaining > 0 ? new Promise(resolve => setTimeout(resolve, remaining)) : Promise.resolve()
            },
            releaseSpace: () => {
                if (mountedRef.current) setSpaceReleased(true)
            },
            cancel: () => {
                if (cancelled) return
                cancelled = true
                reset()
            },
        }
    }, [enabled, opacity, reducedMotion, reset, scaleY, translateX])

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
        // Removing the whole wrapper also removes its padding, margins and any min-height floor.
        // Only this mounted day section is hidden; another day can show the postponed goal normally.
        if (spaceReleased) return { display: 'none' }
        const style = { opacity, pointerEvents: 'none' }
        if (!reducedMotion) {
            style.transform = [{ translateX }, { scaleY }]
        }
        return style
    }, [exiting, opacity, reducedMotion, scaleY, spaceReleased, translateX])

    return { sectionStyle, exiting }
}

/** Test seam. */
export const resetGoalPostponeMotionRegistry = () => {
    motionByGoal.clear()
}
