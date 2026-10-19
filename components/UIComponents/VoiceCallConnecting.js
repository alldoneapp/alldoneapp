import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { useReducedMotion } from './Ghosts/ghostAnimation'

// Browser-composited motion keeps running while call setup is busy. The shared
// preference hook also responds when reduced motion changes during a call.
export default function VoiceCallConnecting({ assistantName }) {
    const reducedMotion = useReducedMotion()
    return (
        <View
            testID="voice-call-connecting"
            style={localStyles.container}
            role="status"
            accessibilityLiveRegion="polite"
        >
            <View style={localStyles.phone} aria-hidden>
                <View style={[localStyles.halo, !reducedMotion && localStyles.pulse]} />
                <View
                    testID="voice-call-connecting-ring"
                    style={[localStyles.ring, !reducedMotion && localStyles.spin]}
                />
                <Icon name="phone-call" size={20} color={colors.Primary100} />
            </View>
            <Text style={localStyles.label}>
                {translate('Connecting with %{assistantName}…', {
                    assistantName: assistantName || translate('Assistant'),
                })}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        minWidth: 0,
        padding: 12,
        borderRadius: 16,
        backgroundColor: colors.Primary100 + '0D',
    },
    phone: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    halo: {
        position: 'absolute',
        inset: 0,
        borderRadius: 100,
        backgroundColor: colors.Primary100 + '18',
    },
    ring: {
        position: 'absolute',
        inset: 0,
        borderRadius: 100,
        borderWidth: 2,
        borderColor: colors.Primary100 + '26',
        borderTopColor: colors.Primary100,
    },
    label: { ...styles.body2, color: colors.Primary300, marginLeft: 12, flexShrink: 1 },
    pulse: {
        animationKeyframes: [{ '0%, 100%': { transform: 'scale(0.9)' }, '50%': { transform: 'scale(1.15)' } }],
        animationDuration: '1.8s',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
    },
    spin: {
        animationKeyframes: [{ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } }],
        animationDuration: '1.2s',
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
    },
})
