import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'

import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import { useReducedMotion } from '../UIComponents/Ghosts/ghostAnimation'
import { translate } from '../../i18n/TranslationService'
import { ROUTING_SUBJECT_GOAL, ROUTING_SUBJECT_PROJECT } from '../../utils/taskRoutingActivity'

/**
 * AT-2381 — the in-row badge for "the server is still deciding where this task belongs" and for
 * "it just decided, and something changed".
 *
 * Shape and placement deliberately copy `InProgressVmTag`: same 24px pill, same leading slot on
 * the task row, same `windowTagStyle()` responsive text. A new visual language for this would
 * read as a different KIND of thing, when in fact it is the same kind — a transient status the
 * row is reporting about background work.
 *
 * The processing badge carries no text on purpose. It sits at the start of the title line where
 * horizontal space is scarcest (a task with a priority chip, a VM tag and a workflow tag is
 * already crowded on a phone), and a label would be redundant with the shimmer sweeping the
 * title right next to it. Screen readers get the full sentence through `accessibilityLabel`, so
 * nothing is lost where it actually matters.
 */

// Three points, twinkling out of phase so the group reads as a shimmer rather than a blink.
// The offsets are hand-placed rather than generated: a symmetric arrangement looks mechanical
// at this size, and the largest point wants to sit off-centre.
const SPARKLE_POINTS = [
    { size: 7, left: 5, top: 4, delay: 0 },
    { size: 4, left: 13, top: 11, delay: 260 },
    { size: 3.5, left: 12, top: 2, delay: 520 },
]

const TWINKLE_DURATION_MS = 780
const SPARKLE_REST_OPACITY = 0.75

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * A single twinkling point. Each owns its own `Animated.Value` because they run out of phase;
 * one shared value with interpolation offsets cannot express a stagger that also loops.
 */
function SparklePoint({ point, animate }) {
    const twinkle = useRef(new Animated.Value(SPARKLE_REST_OPACITY)).current

    useEffect(() => {
        if (!animate) {
            twinkle.setValue(SPARKLE_REST_OPACITY)
            return undefined
        }

        const animation = Animated.loop(
            Animated.sequence([
                Animated.delay(point.delay),
                Animated.timing(twinkle, {
                    toValue: 1,
                    duration: TWINKLE_DURATION_MS / 2,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(twinkle, {
                    toValue: 0.25,
                    duration: TWINKLE_DURATION_MS / 2,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [animate, point.delay, twinkle])

    // Scale rides the same value as opacity so a dimming point also shrinks — that is what makes
    // it read as a sparkle catching the light rather than a status LED fading.
    const scale = twinkle.interpolate({ inputRange: [0.25, 1], outputRange: [0.6, 1] })

    return (
        <Animated.View
            style={[
                localStyles.sparklePoint,
                {
                    width: point.size,
                    height: point.size,
                    borderRadius: point.size / 2,
                    left: point.left,
                    top: point.top,
                    opacity: twinkle,
                    transform: [{ scale }],
                },
            ]}
        />
    )
}

export function RoutingSparkle({ animate }) {
    return (
        <View style={localStyles.sparkle}>
            {SPARKLE_POINTS.map((point, index) => (
                <SparklePoint key={index} point={point} animate={animate} />
            ))}
        </View>
    )
}

const processingLabel = subject =>
    subject === ROUTING_SUBJECT_PROJECT ? translate('Finding the right project') : translate('Finding a matching goal')

/**
 * Reads the reduced-motion preference itself rather than taking it as a prop, matching
 * `TaskRoutingActivityOverlay`. The task row only mounts this component when there is routing
 * activity to report, so the `matchMedia` listener `useReducedMotion` registers is paid by the
 * handful of rows being routed rather than by every row in the list.
 *
 * @param {object} props
 * @param {null | { subject: string }} props.processing
 * @param {null | { subject: string, fromProjectId?: string }} props.confirmation
 * @param {string} props.projectName name of the project the row is rendered in — the project a
 *   moved task has just landed in, which is what the confirmation names
 */
export default function TaskRoutingTag({ processing, confirmation, projectName, style }) {
    const reducedMotion = useReducedMotion()

    if (confirmation) {
        const label =
            confirmation.subject === ROUTING_SUBJECT_GOAL
                ? translate('Added to goal')
                : translate('Moved to project', { project: projectName || translate('this project') })

        return (
            <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={label}
                testID="task-routing-confirmation-tag"
                style={[localStyles.container, localStyles.confirmedContainer, style]}
            >
                <Icon name="check" size={12} color={colors.UtilityGreen300} style={localStyles.checkIcon} />
                <Text numberOfLines={1} style={[styles.subtitle2, localStyles.confirmedText, windowTagStyle()]}>
                    {label}
                </Text>
            </View>
        )
    }

    if (!processing) return null

    const label = processingLabel(processing.subject)

    return (
        <View
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={label}
            testID="task-routing-processing-tag"
            style={[localStyles.container, localStyles.processingContainer, style]}
        >
            <RoutingSparkle animate={!reducedMotion && !animationsAreDisabled()} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        borderRadius: 12,
        flexDirection: 'row',
        height: 24,
        justifyContent: 'center',
    },
    processingContainer: {
        backgroundColor: colors.UtilityBlue100,
        width: 24,
    },
    confirmedContainer: {
        backgroundColor: colors.UtilityGreen100,
        paddingHorizontal: 8,
        // The label is the one thing on the row that must not push the title around, so it is
        // allowed to shrink and truncate rather than widen the leading slot.
        flexShrink: 1,
        maxWidth: 200,
    },
    confirmedText: {
        color: colors.UtilityGreen300,
        flexShrink: 1,
    },
    checkIcon: {
        marginRight: 4,
    },
    sparkle: {
        width: 20,
        height: 18,
    },
    sparklePoint: {
        position: 'absolute',
        backgroundColor: colors.Primary100,
    },
})
