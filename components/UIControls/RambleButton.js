import React, { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import useRambleRecorder from '../../hooks/useRambleRecorder'
import useEscapeKey from '../../hooks/useEscapeKey'
import { processRamble } from '../../utils/backends/Rambler/ramblerBackend'
import { translate } from '../../i18n/TranslationService'
import store from '../../redux/store'
import { setShowLimitedFeatureModal } from '../../redux/actions'

export const RAMBLE_PHASE_IDLE = 'idle'
export const RAMBLE_PHASE_RECORDING = 'recording'
export const RAMBLE_PHASE_PROCESSING = 'processing'

export function formatRambleElapsed(elapsedSeconds) {
    const minutes = Math.floor(elapsedSeconds / 60)
    const seconds = elapsedSeconds % 60
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

/**
 * Records a ramble, sends it through `processRambleSecondGen`, and hands the cleaned text to the
 * caller. Shared between the CustomTextInput3 overlay button and the notes editor toolbar, which
 * render their own chrome around the same phases.
 */
export function useRambleController({ projectId, targetKind = 'generic', getCurrentText, onTextReady }) {
    const [processing, setProcessing] = useState(false)

    // 'silent-input*' means the microphone handed the browser silence (AT-2357) — the recording was
    // never uploaded, so these messages replace a Gold charge and a misleading "No speech detected".
    const handleRecorderError = useCallback((code, details = {}) => {
        if (code === 'permission-denied') {
            alert(translate('Microphone access was denied. Please allow microphone access in your browser settings.'))
        } else if (code === 'silent-input-retry') {
            alert(translate('No sound came from your microphone. Switched recording mode, please try again.'))
        } else if (code === 'silent-input') {
            const deviceLabel = details?.deviceLabel
            // Naming only the device we used reads as an accusation when the user has already picked
            // a different one in macOS — the browser keeps its OWN microphone choice, and that gap
            // is the whole confusion in this failure, so the message has to name it and say where
            // to override it. Listing what else was tried prevents "it didn't even look".
            const triedLabels = (details?.triedDeviceLabels || []).filter(label => label !== deviceLabel)
            if (triedLabels.length) {
                alert(
                    translate('No sound came from any microphone', {
                        device: deviceLabel,
                        devices: triedLabels.join(', '),
                    })
                )
            } else if (deviceLabel) {
                alert(translate('No sound came from the browser microphone', { device: deviceLabel }))
            } else {
                alert(translate('No sound came from your microphone. Check your system input device.'))
            }
        } else if (code !== 'not-supported') {
            alert(translate('Could not process dictation'))
        }
    }, [])

    const handleRecordingComplete = useCallback(
        async ({ audioBase64, mimeType, durationSeconds, deviceLabel }) => {
            setProcessing(true)
            try {
                const requestStartedAt = Date.now()
                const currentText = getCurrentText ? (getCurrentText() || '').slice(0, 2000) : ''
                const result = await processRamble({
                    projectId,
                    audio: audioBase64,
                    mimeType,
                    targetKind,
                    currentText,
                    durationSeconds,
                    language: store.getState().loggedUser?.language,
                })
                // requestMs minus the server totalMs ≈ network + cold start; see the matching
                // '[processRamble] timing' line in the function logs for the server breakdown.
                console.log('[rambler] timing', {
                    requestMs: Date.now() - requestStartedAt,
                    audioSeconds: durationSeconds,
                    ...(result?.timings || {}),
                })
                if (result?.text) onTextReady(result.text)
            } catch (error) {
                console.error('Ramble processing error:', error)
                if (error?.code === 'offline') {
                    // The recording cannot be queued; the connection toast already explains offline.
                } else if (
                    error?.code === 'functions/resource-exhausted' ||
                    error?.code === 'resource-exhausted' ||
                    error?.message?.includes('Insufficient Gold')
                ) {
                    store.dispatch(
                        setShowLimitedFeatureModal({
                            title: translate('Not enough Gold'),
                            description: translate(
                                'You do not have enough Gold to transcribe this audio. Please upgrade or buy more Gold.'
                            ),
                        })
                    )
                } else if (error?.message?.includes('EMPTY_TRANSCRIPT')) {
                    // A microphone can be alive and still be the WRONG one: it records the room
                    // while the user talks into another device, which passes every local check and
                    // only fails here. Naming the device we listened to is the difference between a
                    // dead end and an obvious fix.
                    alert(
                        deviceLabel
                            ? translate('No speech detected on the microphone', { device: deviceLabel })
                            : translate('No speech detected')
                    )
                } else {
                    alert(translate('Could not process dictation'))
                }
            } finally {
                setProcessing(false)
            }
        },
        [projectId, targetKind, getCurrentText, onTextReady]
    )

    const { isRecording, elapsedSeconds, start, stop, cancel } = useRambleRecorder({
        onComplete: handleRecordingComplete,
        onError: handleRecorderError,
    })

    // Escape discards the recording without leaving the input; LIFO stack keeps popups unaffected.
    useEscapeKey(
        useCallback(() => cancel(), [cancel]),
        { enabled: isRecording }
    )

    const phase = processing ? RAMBLE_PHASE_PROCESSING : isRecording ? RAMBLE_PHASE_RECORDING : RAMBLE_PHASE_IDLE

    const toggle = useCallback(() => {
        if (processing) return
        if (isRecording) stop()
        else start()
    }, [processing, isRecording, start, stop])

    return { phase, elapsedSeconds, toggle, cancel }
}

/**
 * The overlay variant used inside CustomTextInput3: a quiet mic icon that becomes a red timer chip
 * while recording. Positioning comes from the host via `style`; the button never affects layout.
 *
 * The host toggles `visible` (focus/hover), but the component stays MOUNTED either way — an active
 * recording or in-flight processing keeps rendering regardless of `visible`, so a hover change can
 * never tear down the recorder mid-ramble.
 */
export default function RambleButton({
    projectId,
    targetKind,
    getCurrentText,
    onTextReady,
    disabled,
    visible = true,
    style,
}) {
    const { phase, elapsedSeconds, toggle } = useRambleController({
        projectId,
        targetKind,
        getCurrentText,
        onTextReady,
    })

    if (disabled) return null
    if (!visible && phase === RAMBLE_PHASE_IDLE) return null

    return (
        <TouchableOpacity
            style={[localStyles.container, phase === RAMBLE_PHASE_RECORDING && localStyles.recordingContainer, style]}
            onPress={toggle}
            // Keep the editor focused and its selection intact while pressing the button.
            onMouseDown={event => event.preventDefault()}
            accessibilityLabel={translate(phase === RAMBLE_PHASE_RECORDING ? 'Stop dictation' : 'Dictate')}
            disabled={phase === RAMBLE_PHASE_PROCESSING}
        >
            {phase === RAMBLE_PHASE_PROCESSING ? (
                <ActivityIndicator size={14} color={colors.Text03} />
            ) : (
                <>
                    <Icon
                        name={'mic'}
                        size={16}
                        color={phase === RAMBLE_PHASE_RECORDING ? colors.Red200 : colors.Text03}
                    />
                    {phase === RAMBLE_PHASE_RECORDING && (
                        <Text style={[styles.caption1, localStyles.elapsedText]}>
                            {formatRambleElapsed(elapsedSeconds)}
                        </Text>
                    )}
                </>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 24,
        paddingHorizontal: 4,
        borderRadius: 12,
    },
    recordingContainer: {
        backgroundColor: colors.Grey100,
    },
    elapsedText: {
        color: colors.Red200,
        marginLeft: 4,
    },
})
