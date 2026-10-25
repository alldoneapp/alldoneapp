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
 * Shape deliberately copies `InProgressVmTag`: same 24px pill, same `windowTagStyle()` responsive
 * text. A new visual language for this would read as a different KIND of thing, when in fact it is
 * the same kind — a transient status the row is reporting about background work.
 *
 * AT-2453 moved it OUT of the leading slot in front of the title and into the row's trailing tag
 * area, next to the project and goal chips that answer the settled version of the same question.
 * See `TaskPresentation.trailingRoutingTag` for why, and for why it is rendered as a sibling of
 * `TaskItemTags` rather than as one more entry in `TagsArea/Tags.js`.
 *
 * AT-2453 follow-up — the processing badge now names its SUBJECT: `project?` while the project
 * router is deciding, `goal?` while the goal router is. It used to be icon-only, and the reason
 * given for that was that a label would be redundant with the shimmer sweeping the title right next
 * to it. That reason died with the shimmer (see `TaskRoutingActivityOverlay`): a lone sparkle says
 * "something is happening" and nothing else, which is the weakest possible version of this feature —
 * the user cannot tell whether the app is about to move their task to a different PROJECT or merely
 * file it under a goal, and those have very different consequences.
 *
 * The wording is a bare noun plus a question mark, and nothing else. An earlier pass wrapped it in
 * brackets — `(project?)` — on the reasoning that the badge is an aside; in the pill it read as
 * punctuation noise around a two-word label, so the brackets are gone and the question mark alone
 * carries the "still deciding" tense that a bare noun would lose. Each subject is still ONE
 * translatable token rather than a noun a template punctuates in code, because the punctuation is
 * language-specific: Spanish opens the question with `¿`.
 *
 * Screen readers still get the full sentence through `accessibilityLabel` — "project?" is a fine
 * glance-value and a poor thing to hear announced.
 */

// Three points, twinkling out of phase so the group reads as a shimmer rather than a blink.
// The offsets are hand-placed rather than generated: a symmetric arrangement looks mechanical
// at this size, and the largest point wants to sit off-centre.
const SPARKLE_POINTS = [
    { size: 7, left: 5, top: 4, delay: 0 },
    { size: 4, left: 13, top: 11, delay: 260 },
    { size: 3.5, left: 12, top: 2, delay: 520 },
]

// The badge is the one part of this feature that has to stay legible — it is the message, and it
// is what survives `prefers-reduced-motion` — so it is toned down rather than faded out. Two
// changes, both aimed at "gentle" rather than "quiet": the points are `UtilityBlue200` instead of
// the saturated `Primary100` action blue, and the twinkle floor is lifted well off zero. A point
// that dips to 0.25 blinks; one that dips to 0.45 breathes. The badge is small and stationary, so
// unlike the sweep it was never the thing dominating the row.
const TWINKLE_DURATION_MS = 900
const TWINKLE_MIN_OPACITY = 0.45
const TWINKLE_MAX_OPACITY = 0.95
const SPARKLE_REST_OPACITY = 0.7

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
                    toValue: TWINKLE_MAX_OPACITY,
                    duration: TWINKLE_DURATION_MS / 2,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: false,
                }),
                Animated.timing(twinkle, {
                    toValue: TWINKLE_MIN_OPACITY,
                    duration: TWINKLE_DURATION_MS / 2,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: false,
                }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [animate, point.delay, twinkle])

    // Scale rides the same value as opacity so a dimming point also shrinks — that is what makes
    // it read as a sparkle catching the light rather than a status LED fading. The range is
    // shallower than it was (0.75→1 rather than 0.6→1) for the same reason the opacity floor was
    // lifted: less travel per beat is what separates "gentle" from "insistent".
    const scale = twinkle.interpolate({
        inputRange: [TWINKLE_MIN_OPACITY, TWINKLE_MAX_OPACITY],
        outputRange: [0.75, 1],
    })

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

// The visible half of the same message. Kept as one translatable token per subject because the
// question mark is punctuation, and punctuation is language-specific — the Spanish form opens with
// `¿`, which a `translate(noun) + '?'` template in code could never produce.
const processingSubjectLabel = subject =>
    subject === ROUTING_SUBJECT_PROJECT ? translate('project?') : translate('goal?')

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
            <Text
                numberOfLines={1}
                testID="task-routing-processing-subject"
                style={[styles.subtitle2, localStyles.processingText, windowTagStyle()]}
            >
                {processingSubjectLabel(processing.subject)}
            </Text>
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
        // Was a fixed 24px circle when the badge was icon-only. It now sizes to its label, and
        // shrinks like the confirmation chip so a narrow row truncates the label instead of pushing
        // the tag row over the title.
        //
        // The left padding is 2 rather than the confirmation's 8 because the sparkle's own 20x18 box
        // already carries ~5px of empty margin before its first point (see SPARKLE_POINTS). 2 puts
        // that first point 7px from the pill's edge — exactly where the old 24px circle centred it —
        // so the two states start at the same place and the pill stays optically balanced against
        // the 8px on the text side. The widest translation, Spanish "¿proyecto?", lands around
        // 100px, so `maxWidth` is a backstop for an unexpectedly long future string, not a
        // day-to-day constraint.
        paddingLeft: 2,
        paddingRight: 8,
        flexShrink: 1,
        maxWidth: 140,
    },
    processingText: {
        // `UtilityBlue300` on `UtilityBlue100` mirrors the confirmation's green-on-green: same
        // contrast relationship, so the two states read as one component in two tenses rather than
        // as two different chips. Deliberately not the saturated `Primary100` action blue — this is
        // a status, and nothing here is clickable.
        color: colors.UtilityBlue300,
        marginLeft: 2,
        flexShrink: 1,
    },
    confirmedContainer: {
        backgroundColor: colors.UtilityGreen100,
        paddingHorizontal: 8,
        // The label is the one thing on the row that must not push the title around, so it is
        // allowed to shrink and truncate rather than widen the tag area without bound.
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
        backgroundColor: colors.UtilityBlue200,
    },
})
