import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'
import { GOAL_EXIT_COLLAPSE_DELAY_MS, GOAL_EXIT_FADE_MS } from './goalSectionExitMotion'
import { POSTPONE_GOAL_EXIT_COLLAPSE_MS } from './goalSectionExitMotion'

/**
 * AT-2534 — how the general "add task" row replaces the final goal section.
 *
 * The goal exit already fades and collapses the departing block. Previously this row was mounted
 * only after that hold ended, so the old content left gracefully and its replacement still popped
 * into the layout in one frame. Mount it at height zero as soon as the exit starts, then reveal it
 * during the existing collapse:
 *
 *   • HEIGHT starts with the goal collapse and finishes with the goal fade. The space released by
 *     one block is therefore taken up continuously by the other instead of disappearing and then
 *     returning.
 *   • CONTENT waits until the replacement has some room, then fades in with a small downward-to-rest
 *     settle. It is fully legible before the departing goal is flat.
 *
 * An ordinary empty list passes run id 0 and renders exactly as it always did. Reduced motion also
 * gets the settled row immediately; the parent does not hold a departing goal in that mode.
 */
export const GENERAL_TASK_ENTRY_EXPAND_DELAY_MS = GOAL_EXIT_COLLAPSE_DELAY_MS
export const GENERAL_TASK_ENTRY_EXPAND_MS = GOAL_EXIT_FADE_MS - GENERAL_TASK_ENTRY_EXPAND_DELAY_MS
export const GENERAL_TASK_ENTRY_FADE_DELAY_MS = 650
export const GENERAL_TASK_ENTRY_FADE_MS = 420
export const GENERAL_TASK_ENTRY_TOTAL_MS = Math.max(
    GENERAL_TASK_ENTRY_EXPAND_DELAY_MS + GENERAL_TASK_ENTRY_EXPAND_MS,
    GENERAL_TASK_ENTRY_FADE_DELAY_MS + GENERAL_TASK_ENTRY_FADE_MS
)
export const POSTPONE_GENERAL_TASK_ENTRY_FADE_DELAY_MS = 40
export const POSTPONE_GENERAL_TASK_ENTRY_FADE_MS = 140

const SETTLE_PX = 6
const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * @param {number} entryRunId 0 for an ordinary row, otherwise the goal-exit run this replaces.
 * @returns {{onContentLayout: Function, sectionStyle: object|undefined, contentStyle: object|undefined,
 *   entering: boolean}}
 */
export const useGeneralTaskSectionEntry = (entryRunId, exitKind = 'completion') => {
    const reducedMotion = useReducedMotion()
    const animated = !reducedMotion && !animationsAreDisabled()
    const [activeRunId, setActiveRunId] = useState(0)
    const [contentHeight, setContentHeight] = useState(0)
    const height = useRef(new Animated.Value(0)).current
    const opacity = useRef(new Animated.Value(0)).current
    const playedRunRef = useRef(0)
    const measuredHeightRef = useRef(0)
    const animationRef = useRef(null)
    const settleTimerRef = useRef(null)

    const onContentLayout = useCallback(event => {
        const measured = event?.nativeEvent?.layout?.height
        if (measured > 0 && measured !== measuredHeightRef.current) {
            measuredHeightRef.current = measured
            setContentHeight(measured)
        }
    }, [])

    useLayoutEffect(() => {
        if (!animated) {
            animationRef.current?.stop()
            clearTimeout(settleTimerRef.current)
            height.setValue(measuredHeightRef.current)
            opacity.setValue(1)
            setActiveRunId(0)
            return undefined
        }
        if (!entryRunId || entryRunId === playedRunRef.current) return undefined
        playedRunRef.current = entryRunId

        height.setValue(0)
        opacity.setValue(0)
        setActiveRunId(entryRunId)
        return undefined
    }, [entryRunId, animated, height, opacity])

    useLayoutEffect(() => {
        if (!activeRunId || contentHeight <= 0) return undefined

        animationRef.current?.stop()
        clearTimeout(settleTimerRef.current)
        height.setValue(0)
        opacity.setValue(0)

        const isPostpone = exitKind === 'postpone'
        const expandDelay = isPostpone ? 0 : GENERAL_TASK_ENTRY_EXPAND_DELAY_MS
        const expandDuration = isPostpone ? POSTPONE_GOAL_EXIT_COLLAPSE_MS : GENERAL_TASK_ENTRY_EXPAND_MS
        const fadeDelay = isPostpone ? POSTPONE_GENERAL_TASK_ENTRY_FADE_DELAY_MS : GENERAL_TASK_ENTRY_FADE_DELAY_MS
        const fadeDuration = isPostpone ? POSTPONE_GENERAL_TASK_ENTRY_FADE_MS : GENERAL_TASK_ENTRY_FADE_MS
        const totalDuration = isPostpone
            ? Math.max(expandDelay + expandDuration, fadeDelay + fadeDuration)
            : GENERAL_TASK_ENTRY_TOTAL_MS

        const animation = Animated.parallel([
            Animated.sequence([
                Animated.delay(expandDelay),
                Animated.timing(height, {
                    toValue: contentHeight,
                    duration: expandDuration,
                    easing: Easing.inOut(Easing.cubic),
                    useNativeDriver: false,
                }),
            ]),
            Animated.sequence([
                Animated.delay(fadeDelay),
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: fadeDuration,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: false,
                }),
            ]),
        ])
        animationRef.current = animation
        animation.start()

        // Settle on a timer instead of trusting a composite callback. This is the same rule as the
        // surrounding completion motions: interrupted renderers must still end in the resting UI.
        settleTimerRef.current = setTimeout(() => {
            if (playedRunRef.current !== activeRunId) return
            height.setValue(contentHeight)
            opacity.setValue(1)
            setActiveRunId(0)
        }, totalDuration)

        return () => {
            clearTimeout(settleTimerRef.current)
            animation.stop()
        }
    }, [activeRunId, contentHeight, exitKind, height, opacity])

    const sectionStyle = useMemo(
        () =>
            activeRunId
                ? {
                      height,
                      overflow: 'hidden',
                      pointerEvents: 'none',
                  }
                : undefined,
        [activeRunId, height]
    )
    const contentStyle = useMemo(
        () =>
            activeRunId
                ? {
                      opacity,
                      transform: [
                          {
                              translateY: opacity.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [SETTLE_PX, 0],
                              }),
                          },
                      ],
                  }
                : undefined,
        [activeRunId, opacity]
    )

    return { onContentLayout, sectionStyle, contentStyle, entering: !!activeRunId }
}

export default function GeneralTaskSectionEntry({ entryRunId = 0, exitKind = 'completion', children }) {
    const { onContentLayout, sectionStyle, contentStyle } = useGeneralTaskSectionEntry(entryRunId, exitKind)

    return (
        <Animated.View style={sectionStyle} testID="general-task-section-entry">
            <Animated.View onLayout={onContentLayout} style={contentStyle}>
                {children}
            </Animated.View>
        </Animated.View>
    )
}
