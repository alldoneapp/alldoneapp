import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { describeBackgroundCallSupport, BACKGROUND_SUPPORT_FOREGROUND_ONLY } from './assistantCallBackground'
import useModalSizing from '../../hooks/useModalSizing'
import { translate } from '../../i18n/TranslationService'
import Button from '../UIControls/Button'
import Icon from '../Icon'
import Spinner from './Spinner'
import styles, { colors } from '../styles/global'

export default function FloatingCallControls({ call }) {
    const { keyboardInset, safeAreaInsets } = useModalSizing()
    if (call.status === 'idle' && !call.error) return null
    const showForegroundHint =
        call.status !== 'idle' && describeBackgroundCallSupport().level === BACKGROUND_SUPPORT_FOREGROUND_ONLY
    const connecting = call.status === 'connecting'
    const seconds = Math.max(0, Math.floor(call.voiceSeconds))
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    const label = translate(connecting ? 'Cancel assistant call' : 'End assistant call')
    return (
        <View
            testID="floating-voice-call"
            style={[
                localStyles.floating,
                {
                    right: 16 + safeAreaInsets.right,
                    bottom: 16 + keyboardInset + (keyboardInset ? 0 : safeAreaInsets.bottom),
                },
            ]}
        >
            <View style={localStyles.row}>
                {call.status === 'idle' ? (
                    <>
                        <Text accessibilityLiveRegion="polite" style={localStyles.error}>
                            {call.error}
                        </Text>
                        <Button
                            type="ghost"
                            icon="x"
                            onPress={call.dismissError}
                            accessibilityLabel={translate('Close')}
                            accessible
                        />
                    </>
                ) : (
                    <>
                        {!!call.callName && (
                            <Text style={localStyles.name} numberOfLines={1}>
                                {call.callName}
                            </Text>
                        )}
                        {call.needsAudioPlayback && (
                            <Button
                                type="ghost"
                                icon="volume-2"
                                onPress={call.playCallAudio}
                                accessibilityLabel={translate('Enable call audio')}
                                accessible
                            />
                        )}
                        <Button
                            type="danger"
                            icon={
                                connecting ? (
                                    <View style={localStyles.connecting}>
                                        <Spinner containerSize={24} spinnerSize={24} containerColor="transparent" />
                                        <Icon name="x" size={12} color={colors.Text03} style={localStyles.cancelIcon} />
                                    </View>
                                ) : (
                                    'phone-call'
                                )
                            }
                            title={connecting ? translate('Calling') : duration}
                            onPress={call.endCall}
                            disabled={call.status === 'ending'}
                            buttonStyle={localStyles.button}
                            accessibilityLabel={label}
                            accessible
                        />
                    </>
                )}
            </View>
            {showForegroundHint && (
                <Text style={localStyles.foregroundHint}>
                    {translate(
                        'Keep Alldone open during the call, this browser pauses the microphone in the background'
                    )}
                </Text>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    floating: {
        position: 'fixed',
        zIndex: 100000,
        alignItems: 'flex-end',
        padding: 8,
        borderRadius: 32,
        backgroundColor: '#FFFFFF',
        boxShadow: '0 3px 12px rgba(0, 0, 0, 0.18)',
        maxWidth: 'calc(100vw - 32px)',
    },
    row: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%' },
    foregroundHint: { ...styles.caption1, color: colors.Text03, maxWidth: 260, padding: 8 },
    button: { height: 48, minHeight: 48, borderRadius: 24 },
    name: { ...styles.body2, color: colors.Text02, marginHorizontal: 8, maxWidth: 100, flexShrink: 1 },
    error: { ...styles.caption1, color: colors.UtilityRed200, maxWidth: 220, flexShrink: 1 },
    connecting: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    cancelIcon: { position: 'absolute' },
})
