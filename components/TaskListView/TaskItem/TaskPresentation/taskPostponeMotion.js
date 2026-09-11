import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { cancelGoalTaskPostpone, publishGoalTaskPostpone } from '../../OpenTasksView/goalPostponeSignal'

/**
 * AT-2541 — the short exit used when postponing a top-level task out of Today/My Day.
 *
 * The popup that chooses the new date is not always mounted inside the visible row (the swipe
 * popup is global, while the inline reminder picker replaces the presentation with an editor).
 * The registry below lets either surface borrow the motion owned by the mounted TaskItem without
 * putting transient animation state in redux and re-rendering every task on the board.
 */

export const POSTPONE_SLIDE_FADE_MS = 220
export const POSTPONE_COLLAPSE_MS = 130
export const POSTPONE_EXIT_TOTAL_MS = POSTPONE_SLIDE_FADE_MS + POSTPONE_COLLAPSE_MS
export const POSTPONE_REDUCED_FADE_MS = 120
export const POSTPONE_TRANSLATE_X = -96

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'
const motionByTask = new Map()

const keyFor = (projectId, taskId) => `${projectId}:${taskId}`

export const targetLeavesToday = (targetDate, now = Date.now()) =>
    Number.isFinite(targetDate) && targetDate > new Date(now).setHours(23, 59, 59, 999)

const registerTaskPostponeMotion = (projectId, taskId, begin) => {
    if (!projectId || !taskId || typeof begin !== 'function') return () => {}
    const key = keyFor(projectId, taskId)
    motionByTask.set(key, begin)
    return () => {
        if (motionByTask.get(key) === begin) motionByTask.delete(key)
    }
}

/**
 * Runs the mounted row's motion only when this write changes the date that placed that row in
 * Today. Review rows are placed by the assignee due date; observed-only rows are placed by the
 * logged user's observer date. Callers describe which fields their write changes so changing the
 * other date never animates a row that will remain on screen.
 */
export const postponeTaskWithMotion = async (
    { projectId, task, targetDate, updatesDueDate = true, updatesObservedDate = false },
    write
) => {
    const begin = motionByTask.get(keyFor(projectId, task?.id))
    const canLeave = targetLeavesToday(targetDate)
    const run =
        canLeave && typeof begin === 'function'
            ? begin({ updatesDueDate, updatesObservedDate })
            : { settled: () => Promise.resolve(), cancel: () => {} }

    try {
        await run.settled()
        return await write()
    } catch (error) {
        run.cancel()
        throw error
    }
}

export default function useTaskPostponeMotion({
    enabled = false,
    projectId,
    taskId,
    goalId,
    isObservedTask = false,
    isToReviewTask = false,
} = {}) {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [exiting, setExiting] = useState(false)
    const [exitHeight, setExitHeight] = useState(0)

    const translateX = useRef(new Animated.Value(0)).current
    const opacity = useRef(new Animated.Value(1)).current
    const height = useRef(new Animated.Value(0)).current
    const measuredHeightRef = useRef(0)
    const animationRef = useRef(null)
    const exitingRef = useRef(false)

    const onRowLayout = useCallback(event => {
        const measured = event?.nativeEvent?.layout?.height
        if (measured > 0 && !exitingRef.current) measuredHeightRef.current = measured
    }, [])

    const reset = useCallback(() => {
        animationRef.current?.stop()
        animationRef.current = null
        translateX.setValue(0)
        opacity.setValue(1)
        height.setValue(0)
        exitingRef.current = false
        setExitHeight(0)
        setExiting(false)
    }, [height, opacity, translateX])

    const begin = useCallback(
        ({ updatesDueDate, updatesObservedDate }) => {
            // An observed-only row is selected by its observer date. A review row can also be
            // observed, but is selected by the assignee due date (the same precedence My Day uses).
            const rowUsesObservedDate = isObservedTask && !isToReviewTask
            const changesPlacementDate = rowUsesObservedDate ? updatesObservedDate : updatesDueDate
            if (!enabled || !changesPlacementDate || exitingRef.current || animationsAreDisabled()) {
                return { settled: () => Promise.resolve(), cancel: () => {} }
            }

            exitingRef.current = true
            setExiting(true)
            translateX.setValue(0)
            opacity.setValue(1)

            const measured = measuredHeightRef.current
            height.setValue(measured)
            setExitHeight(measured)

            let animation
            let holdMs
            if (reducedMotion) {
                // Reduced motion keeps the status change perceptible, but neither moves the row nor
                // animates layout. The snapshot performs the ordinary, immediate removal after it.
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
                ])
                holdMs = POSTPONE_EXIT_TOTAL_MS
                if (goalId) publishGoalTaskPostpone({ projectId, goalId, taskId })
            }

            animationRef.current = animation
            animation.start()
            const startedAt = Date.now()
            let cancelled = false

            return {
                settled: () => {
                    const remaining = holdMs - (Date.now() - startedAt)
                    return remaining > 0 ? new Promise(resolve => setTimeout(resolve, remaining)) : Promise.resolve()
                },
                cancel: () => {
                    if (cancelled) return
                    cancelled = true
                    if (goalId && !reducedMotion) cancelGoalTaskPostpone({ projectId, goalId, taskId })
                    reset()
                },
            }
        },
        [
            enabled,
            goalId,
            height,
            isObservedTask,
            isToReviewTask,
            opacity,
            projectId,
            reducedMotion,
            reset,
            taskId,
            translateX,
        ]
    )

    useEffect(() => {
        if (!enabled) return undefined
        return registerTaskPostponeMotion(projectId, taskId, begin)
    }, [begin, enabled, projectId, taskId])

    useEffect(
        () => () => {
            animationRef.current?.stop()
            animationRef.current = null
        },
        []
    )

    const rowStyle = useMemo(() => {
        if (!exiting) return undefined
        const style = { opacity, pointerEvents: 'none' }
        if (!reducedMotion) {
            style.transform = [{ translateX }]
            if (exitHeight > 0) {
                style.height = height
                style.overflow = 'hidden'
            }
        }
        return style
    }, [exitHeight, exiting, height, opacity, reducedMotion, translateX])

    return { onRowLayout, rowStyle, exiting }
}

/** Test seam. */
export const resetTaskPostponeMotionRegistry = () => motionByTask.clear()
