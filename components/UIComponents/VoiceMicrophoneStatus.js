import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'

// Keep 10 Hz meter updates inside this small component, not in the app-wide
// call context (which would rerender every assistant composer while speaking).
export default function VoiceMicrophoneStatus({ read, compact = false }) {
    const [input, setInput] = useState(() => read?.() || {})
    useEffect(() => {
        const sample = () => setInput(read?.() || {})
        sample()
        const timer = setInterval(sample, 100)
        return () => clearInterval(timer)
    }, [read])
    const level = input.available && !input.muted ? Math.max(0, Math.min(1, input.level || 0)) : 0
    // Perceptual display only; selection and diagnostics use the original level.
    const percent = Math.round(Math.sqrt(level) * 100)
    const label = input.label || translate('Microphone')
    const state = input.muted
        ? 'Microphone paused'
        : !input.available
          ? 'Microphone meter unavailable'
          : !input.sending
            ? 'Microphone preview'
            : 'Microphone level'
    return (
        <View
            style={[localStyles.container, compact && localStyles.compactContainer]}
            testID="voice-microphone-status"
            title={`${label} · ${translate(state)}`}
        >
            <View style={localStyles.row}>
                <Icon name={input.muted ? 'mic-off' : 'mic'} size={12} color={colors.Text03} />
                {!compact && (
                    <Text
                        testID="voice-microphone-name"
                        numberOfLines={1}
                        style={localStyles.label}
                        accessibilityLabel={translate('Microphone: %{name}', { name: label })}
                        title={label}
                    >
                        {label}
                    </Text>
                )}
            </View>
            <View
                testID="voice-microphone-level"
                style={[localStyles.meter, compact && localStyles.compactMeter]}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={translate(state)}
                accessibilityValue={{ min: 0, max: 100, now: percent }}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <View style={[localStyles.fill, { width: `${percent}%` }]} />
            </View>
            {!compact && state !== 'Microphone level' && <Text style={localStyles.hint}>{translate(state)}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: { marginTop: 2, width: '100%' },
    compactContainer: { marginTop: 0, width: 64, flexShrink: 0, flexDirection: 'row', alignItems: 'center' },
    compactMeter: { flex: 1, marginTop: 0, marginLeft: 5 },
    row: { flexDirection: 'row', alignItems: 'center' },
    label: { ...styles.caption1, color: colors.Text03, marginLeft: 4, flexShrink: 1 },
    meter: { height: 4, borderRadius: 2, backgroundColor: '#E7ECEF', overflow: 'hidden', marginTop: 3 },
    fill: { height: '100%', backgroundColor: '#36A77B', transition: 'width 80ms linear' },
    hint: { ...styles.caption1, color: colors.Text03, marginTop: 2 },
})
