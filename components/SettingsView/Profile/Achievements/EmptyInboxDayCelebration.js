import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native'

import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

const CELEBRATION_VISIBLE_DURATION = 2600
const BURST_DOTS = [
    { x: -42, y: -12, color: colors.UtilityGreen200 },
    { x: -26, y: -28, color: colors.UtilityYellow200 },
    { x: -6, y: -34, color: colors.UtilityBlue200 },
    { x: 14, y: -32, color: colors.UtilityViolet200 },
    { x: 34, y: -23, color: colors.UtilityOrange200 },
    { x: 45, y: -4, color: colors.UtilityGreen200 },
]

function useReducedMotionPreference() {
    const [reducedMotion, setReducedMotion] = useState(null)

    useEffect(() => {
        let mounted = true
        const updatePreference = value => mounted && setReducedMotion(Boolean(value))

        if (AccessibilityInfo.isReduceMotionEnabled) {
            Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
                .then(updatePreference)
                .catch(() => updatePreference(false))
        } else {
            updatePreference(false)
        }

        const subscription = AccessibilityInfo.addEventListener
            ? AccessibilityInfo.addEventListener('reduceMotionChanged', updatePreference)
            : null

        return () => {
            mounted = false
            if (subscription && subscription.remove) subscription.remove()
            else if (AccessibilityInfo.removeEventListener) {
                AccessibilityInfo.removeEventListener('reduceMotionChanged', updatePreference)
            }
        }
    }, [])

    return reducedMotion
}

export default function EmptyInboxDayCelebration({ runId, currentStreak }) {
    const [visible, setVisible] = useState(false)
    const reducedMotion = useReducedMotionPreference()
    const visibility = useRef(new Animated.Value(0)).current
    const burst = useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (!runId || !AccessibilityInfo.announceForAccessibility) return

        AccessibilityInfo.announceForAccessibility(translate('Empty inbox streak day added', { count: currentStreak }))
    }, [runId])

    useEffect(() => {
        if (!runId || reducedMotion === null) return undefined

        let hideTimer
        setVisible(true)
        visibility.stopAnimation()
        burst.stopAnimation()

        if (reducedMotion) {
            visibility.setValue(1)
            burst.setValue(1)
            hideTimer = setTimeout(() => setVisible(false), CELEBRATION_VISIBLE_DURATION)
        } else {
            visibility.setValue(0)
            burst.setValue(0)
            Animated.parallel([
                Animated.sequence([
                    Animated.timing(visibility, {
                        toValue: 1,
                        duration: 280,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }),
                    Animated.delay(CELEBRATION_VISIBLE_DURATION),
                    Animated.timing(visibility, {
                        toValue: 0,
                        duration: 240,
                        easing: Easing.in(Easing.cubic),
                        useNativeDriver: true,
                    }),
                ]),
                Animated.timing(burst, {
                    toValue: 1,
                    duration: 720,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
            ]).start(result => {
                if (result && result.finished) setVisible(false)
            })
        }

        return () => {
            clearTimeout(hideTimer)
            visibility.stopAnimation()
            burst.stopAnimation()
        }
    }, [runId, reducedMotion])

    if (!visible) return null

    const bannerTranslateY = visibility.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] })
    const iconScale = burst.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.7, 1.15, 1] })
    const dotOpacity = burst.interpolate({
        inputRange: [0, 0.12, 0.72, 1],
        outputRange: [0, 1, 0.8, 0],
    })

    return (
        <Animated.View
            pointerEvents="none"
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={translate('Empty inbox streak day added', { count: currentStreak })}
            style={[
                localStyles.container,
                {
                    opacity: visibility,
                    transform: [{ translateY: bannerTranslateY }],
                },
            ]}
        >
            <View style={localStyles.iconArea}>
                <Animated.View style={[localStyles.iconCircle, { transform: [{ scale: iconScale }] }]}>
                    <Icon name="check" size={14} color="#FFFFFF" />
                </Animated.View>
                {BURST_DOTS.map((dot, index) => {
                    const translateX = burst.interpolate({ inputRange: [0, 1], outputRange: [0, dot.x] })
                    const translateY = burst.interpolate({ inputRange: [0, 1], outputRange: [0, dot.y] })
                    const scale = burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.3, 1, 0.5] })

                    return (
                        <Animated.View
                            key={index}
                            style={[
                                localStyles.dot,
                                {
                                    backgroundColor: dot.color,
                                    opacity: dotOpacity,
                                    transform: [{ translateX }, { translateY }, { scale }],
                                },
                            ]}
                        />
                    )
                })}
            </View>
            <View style={localStyles.copy}>
                <Text style={[styles.subtitle2, localStyles.title]}>{translate('Today counts')}</Text>
                <Text style={[styles.caption1, localStyles.description]}>
                    {translate('Empty inbox streak day added', { count: currentStreak })}
                </Text>
            </View>
            <View style={localStyles.plusOnePill}>
                <Text style={[styles.subtitle2, localStyles.plusOneText]}>+1</Text>
            </View>
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        width: '100%',
        maxWidth: 520,
        minHeight: 64,
        marginTop: 20,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: colors.UtilityGreen125,
        borderRadius: 8,
        backgroundColor: colors.UtilityGreen100,
    },
    iconArea: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconCircle: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
        backgroundColor: colors.UtilityGreen200,
        zIndex: 1,
    },
    dot: {
        position: 'absolute',
        width: 5,
        height: 5,
        borderRadius: 3,
    },
    copy: {
        flex: 1,
        minWidth: 0,
        marginLeft: 12,
        marginRight: 8,
    },
    title: {
        color: colors.Green400,
    },
    description: {
        color: colors.Text02,
        marginTop: 1,
        flexShrink: 1,
    },
    plusOnePill: {
        minWidth: 42,
        height: 28,
        paddingHorizontal: 9,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        backgroundColor: colors.UtilityGreen200,
    },
    plusOneText: {
        color: '#FFFFFF',
    },
})
