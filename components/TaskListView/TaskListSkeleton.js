import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import { colors } from '../styles/global'

const DEFAULT_ROW_COUNT = 3
const TITLE_WIDTHS = ['58%', '74%', '46%', '66%']

const useReducedMotion = () => {
    const [reducedMotion, setReducedMotion] = useState(false)

    useEffect(() => {
        let mounted = true
        const updatePreference = value => {
            if (mounted) setReducedMotion(!!value)
        }

        if (AccessibilityInfo.isReduceMotionEnabled) {
            Promise.resolve(AccessibilityInfo.isReduceMotionEnabled()).then(updatePreference)
        }

        const subscription = AccessibilityInfo.addEventListener
            ? AccessibilityInfo.addEventListener('reduceMotionChanged', updatePreference)
            : null

        return () => {
            mounted = false
            if (subscription?.remove) subscription.remove()
            else if (AccessibilityInfo.removeEventListener) {
                AccessibilityInfo.removeEventListener('reduceMotionChanged', updatePreference)
            }
        }
    }, [])

    return reducedMotion
}

/**
 * Loading rows shaped like the normal 34px task presentation. Keeping the
 * checkbox, title and trailing tag footprints aligned with a real task makes
 * the final replacement visually quiet instead of inserting a generic spinner.
 */
export default function TaskListSkeleton({
    rowCount = DEFAULT_ROW_COUNT,
    showDateHeader = false,
    taskKeys = [],
    embedded = false,
}) {
    const pulse = useRef(new Animated.Value(0.55)).current
    const reducedMotion = useReducedMotion()

    useEffect(() => {
        if (process.env.NODE_ENV === 'test' || reducedMotion) {
            pulse.setValue(0.7)
            return undefined
        }

        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 750,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0.55,
                    duration: 750,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [pulse, reducedMotion])

    const rows = Array.from({ length: Math.max(0, rowCount) })

    return (
        <View
            testID="task-list-loading-skeleton"
            accessibilityLabel={translate('Loading tasks')}
            accessibilityRole="progressbar"
            style={!embedded && localStyles.container}
        >
            {showDateHeader && (
                <View style={localStyles.dateHeaderContainer}>
                    <Animated.View style={[localStyles.dateHeader, { opacity: pulse }]} />
                </View>
            )}
            {rows.map((_, index) => (
                <View
                    key={taskKeys[index] || index}
                    testID="task-loading-skeleton-row"
                    style={localStyles.taskContainer}
                >
                    <View style={localStyles.taskRow}>
                        <Animated.View style={[localStyles.checkbox, { opacity: pulse }]} />
                        <View style={localStyles.titleContainer}>
                            <Animated.View
                                style={[
                                    localStyles.title,
                                    { width: TITLE_WIDTHS[index % TITLE_WIDTHS.length], opacity: pulse },
                                ]}
                            />
                        </View>
                        <Animated.View style={[localStyles.tag, { opacity: pulse }]} />
                    </View>
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
    },
    dateHeaderContainer: {
        paddingTop: 8,
        paddingBottom: 8,
    },
    dateHeader: {
        height: 24,
        borderRadius: 4,
        backgroundColor: colors.Grey200,
    },
    taskContainer: {
        justifyContent: 'center',
        marginLeft: -16,
        marginRight: -16,
    },
    taskRow: {
        height: 34,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 8,
        marginHorizontal: 8,
        borderRadius: 4,
    },
    checkbox: {
        width: 24,
        height: 24,
        marginTop: 8,
        borderRadius: 4,
        backgroundColor: colors.Grey300,
    },
    titleContainer: {
        flex: 1,
        paddingLeft: 12,
    },
    title: {
        height: 12,
        marginTop: 11,
        borderRadius: 6,
        backgroundColor: colors.Grey300,
    },
    tag: {
        width: 48,
        height: 16,
        marginTop: 9,
        marginRight: 8,
        borderRadius: 8,
        backgroundColor: colors.Grey200,
    },
})
