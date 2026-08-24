import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import useRambleRecorder from '../../hooks/useRambleRecorder'
import useEscapeKey from '../../hooks/useEscapeKey'
import usePushToTalkGesture from '../../hooks/usePushToTalkGesture'
import RambleHoldOverlay from './RambleHoldOverlay'
import { HAPTIC_CANCEL_ARMED_MS, HAPTIC_CANCEL_DISARMED_MS, vibrate } from '../../utils/haptics'
import {
    PUSH_TO_TALK_DISCARD,
    PUSH_TO_TALK_MIN_RECORDING_MS,
    PUSH_TO_TALK_STOP,
    PUSH_TO_TALK_SUBMIT,
    isCancelArmed,
    resolveCancelProgress,
    resolvePushToTalkRelease,
} from './pushToTalk'
import { processRamble } from '../../utils/backends/Rambler/ramblerBackend'
import { translate } from '../../i18n/TranslationService'
import store from '../../redux/store'
import { setShowLimitedFeatureModal } from '../../redux/actions'

// A pointer press leaves a trailing `click`; react-native-web turns that into `onPress`, which
// would toggle the recorder a second time right after the gesture already handled the release.
export const POINTER_CLICK_SUPPRESSION_MS = 700

/**
 * How long a press has to last before the hold overlay (AT-2408) appears. Comfortably above an
 * intentional tap (~80-150ms) so tapping the mic to start a normal dictation does not flash a ring
 * across the screen, and comfortably below `PUSH_TO_TALK_HOLD_MS` (400) so the overlay is always
 * already up by the time the press counts as a hold.
 */
export const RAMBLE_HOLD_OVERLAY_DELAY_MS = 200

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
export function useRambleController({ projectId, targetKind = 'generic', getCurrentText, onTextReady, onSubmit }) {
    const [processing, setProcessing] = useState(false)

    // Armed by a push-to-talk release and consumed by the completion below, so that only the take
    // the user actually held for is submitted. A tap-started take that happens to finish while a
    // hold is in flight must not inherit the arming, which is why it is cleared on every exit path
    // (success, error, cancel) rather than only on success.
    const submitOnCompleteRef = useRef(false)
    const onSubmitRef = useRef(onSubmit)
    onSubmitRef.current = onSubmit

    // 'silent-input*' means the microphone handed the browser silence (AT-2357) — the recording was
    // never uploaded, so these messages replace a Gold charge and a misleading "No speech detected".
    const handleRecorderError = useCallback((code, details = {}) => {
        // A take that failed is never submitted; drop the arming so a later tap-started recording
        // cannot inherit it.
        submitOnCompleteRef.current = false
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
            const shouldSubmit = submitOnCompleteRef.current
            submitOnCompleteRef.current = false
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
                if (result?.text) {
                    onTextReady(result.text)
                    // Push-to-talk: the transcript is inserted AND sent, with no review step
                    // (AT-2405). Submitting is the host's job — it is the only layer that knows
                    // what "send" means for this input (post a comment, create a task, save a
                    // goal) and what guards apply (an open popup, an in-flight submit).
                    if (shouldSubmit) onSubmitRef.current?.(result.text)
                }
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

    const { isRecording, elapsedSeconds, start, stop, cancel, getInputLevel } = useRambleRecorder({
        onComplete: handleRecordingComplete,
        onError: handleRecorderError,
    })

    // Escape discards the recording without leaving the input; LIFO stack keeps popups unaffected.
    useEscapeKey(
        useCallback(() => {
            submitOnCompleteRef.current = false
            cancel()
        }, [cancel]),
        { enabled: isRecording }
    )

    const phase = processing ? RAMBLE_PHASE_PROCESSING : isRecording ? RAMBLE_PHASE_RECORDING : RAMBLE_PHASE_IDLE

    const toggle = useCallback(() => {
        if (processing) return
        if (isRecording) stop()
        else start()
    }, [processing, isRecording, start, stop])

    // Read through a ref rather than the `isRecording` state: press-down and release are raw DOM
    // events, so they can both land inside a single React commit and would otherwise both see the
    // stale pre-press value.
    const recordingRef = useRef(false)
    recordingRef.current = isRecording
    const pressStartedRecordingRef = useRef(false)
    const processingRef = useRef(false)
    processingRef.current = processing

    /**
     * Press-down ALWAYS starts a recording if one is not already running — a tap and a hold are
     * the same gesture until the user lets go. See `pushToTalk.js` for why the recording cannot
     * wait for the hold threshold to elapse.
     *
     * @returns {boolean} whether THIS press started a recording. The hold overlay (AT-2408) is
     *   shown only then: a press that landed on an already-running tap-started take is the toggle's
     *   second tap, and for it sliding away does NOT cancel — drawing a cancel ring over a gesture
     *   that does not cancel would be a lie.
     */
    const handlePressStart = useCallback(() => {
        if (processingRef.current) {
            pressStartedRecordingRef.current = false
            return false
        }
        if (recordingRef.current) {
            pressStartedRecordingRef.current = false
            return false
        }
        pressStartedRecordingRef.current = true
        submitOnCompleteRef.current = false
        start()
        return true
    }, [start])

    const handlePressEnd = useCallback(
        ({ heldMs, releasedInside, cancelled, distance }) => {
            const pressStartedRecording = pressStartedRecordingRef.current
            pressStartedRecordingRef.current = false
            if (processingRef.current && !pressStartedRecording) return

            const outcome = resolvePushToTalkRelease({
                heldMs,
                releasedInside,
                distance,
                cancelled,
                pressStartedRecording,
            })

            if (outcome === PUSH_TO_TALK_SUBMIT) {
                // Arm BEFORE stopping: `stop()` can run the recorder's `onstop` synchronously.
                submitOnCompleteRef.current = true
                // The recorder vetoes a take with too little audio in it (an accidental hold, or
                // one that released before the microphone finished opening) and says so by
                // returning false — in which case nothing was captured to submit.
                if (!stop({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })) {
                    submitOnCompleteRef.current = false
                }
            } else if (outcome === PUSH_TO_TALK_STOP) {
                stop()
            } else if (outcome === PUSH_TO_TALK_DISCARD) {
                submitOnCompleteRef.current = false
                cancel()
            }
            // PUSH_TO_TALK_KEEP_RECORDING: a tap. The recording runs on until the next tap, which
            // is exactly the behaviour the mic has always had.
        },
        [stop, cancel]
    )

    return { phase, elapsedSeconds, toggle, cancel, getInputLevel, handlePressStart, handlePressEnd }
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
    onSubmit,
    disabled,
    visible = true,
    style,
}) {
    const { phase, elapsedSeconds, toggle, getInputLevel, handlePressStart, handlePressEnd } = useRambleController({
        projectId,
        targetKind,
        getCurrentText,
        onTextReady,
        onSubmit,
    })

    // The node is held in state, not a ref: this button unmounts whenever it is hidden while idle,
    // so the gesture effect has to re-run against the new node when it comes back. TouchableOpacity
    // forwards its ref to the host DOM node (useMergeRefs), so the raw listeners and react-native-
    // web's own press handling coexist on the same element.
    const [buttonNode, setButtonNode] = useState(null)
    const [pressed, setPressed] = useState(false)
    const gestureEndedAtRef = useRef(0)

    // --- hold overlay state (AT-2408) -------------------------------------------------------
    // Where the ring is drawn, and whether it is drawn at all. `hold.origin === null` covers a
    // press we could not locate (a synthetic event with no coordinates); the recording still runs,
    // it just gets no ring, which is strictly better than a ring in the top-left corner.
    const [hold, setHold] = useState(null)
    const [cancelArmed, setCancelArmed] = useState(false)
    // Written on every pointermove. An Animated.Value rather than state on purpose: a number in
    // state would re-render this button — and through it the host input — at pointer-event rate.
    const cancelProgress = useRef(new Animated.Value(0)).current
    const cancelArmedRef = useRef(false)
    const holdTimerRef = useRef(null)

    const clearHoldTimer = () => {
        if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current)
            holdTimerRef.current = null
        }
    }
    useEffect(() => clearHoldTimer, [])

    // The gesture stops the press from propagating (a mic can sit inside a draggable task row), so
    // react-native-web's responder never grants and its own `activeOpacity` never runs. Holding a
    // button with no feedback at all reads as a dead control, so the pressed state is driven here.
    const onGesturePressStart = useCallback(
        point => {
            setPressed(true)
            const startedRecording = handlePressStart()
            cancelProgress.setValue(0)
            cancelArmedRef.current = false
            setCancelArmed(false)
            clearHoldTimer()
            if (!startedRecording || !point) return
            // Deliberately delayed. A tap is 80–150ms and also comes through here, so showing the
            // ring on press-down would flash a 190px circle over the screen every time somebody
            // taps the mic to start a normal dictation. The delay is still well under the 400ms
            // hold threshold, so by the time the press COUNTS as a hold the overlay is already up.
            holdTimerRef.current = setTimeout(() => {
                holdTimerRef.current = null
                setHold({ x: point.clientX, y: point.clientY })
            }, RAMBLE_HOLD_OVERLAY_DELAY_MS)
        },
        [handlePressStart, cancelProgress]
    )

    const onGesturePressMove = useCallback(
        ({ distance }) => {
            cancelProgress.setValue(resolveCancelProgress(distance))
            const armed = isCancelArmed(distance)
            if (armed === cancelArmedRef.current) return
            cancelArmedRef.current = armed
            setCancelArmed(armed)
            // The thumb is on top of the control and the eyes are usually on the text, so crossing
            // the boundary is the one moment a buzz says something the screen cannot. Decoration
            // only — the ring and the card already changed.
            vibrate(armed ? HAPTIC_CANCEL_ARMED_MS : HAPTIC_CANCEL_DISARMED_MS)
        },
        [cancelProgress]
    )

    const onGesturePressEnd = useCallback(
        release => {
            setPressed(false)
            clearHoldTimer()
            setHold(null)
            setCancelArmed(false)
            cancelArmedRef.current = false
            cancelProgress.setValue(0)
            gestureEndedAtRef.current = Date.now()
            handlePressEnd(release)
        },
        [handlePressEnd, cancelProgress]
    )

    usePushToTalkGesture(buttonNode, {
        enabled: phase !== RAMBLE_PHASE_PROCESSING,
        onPressStart: onGesturePressStart,
        onPressMove: onGesturePressMove,
        onPressEnd: onGesturePressEnd,
    })

    if (disabled) return null
    if (!visible && phase === RAMBLE_PHASE_IDLE) return null

    return (
        <>
            {/* Mounted only for the duration of a hold: it portals out of the input, listens for
                resizes and runs an animation frame, none of which a resting mic should pay for. */}
            {hold ? (
                <RambleHoldOverlay
                    visible
                    originX={hold.x}
                    originY={hold.y}
                    progress={cancelProgress}
                    armed={cancelArmed}
                    elapsedLabel={formatRambleElapsed(elapsedSeconds)}
                    getInputLevel={getInputLevel}
                />
            ) : null}
            <TouchableOpacity
                ref={setButtonNode}
                style={[
                    localStyles.container,
                    phase === RAMBLE_PHASE_RECORDING && localStyles.recordingContainer,
                    cancelArmed && localStyles.cancelArmedContainer,
                    pressed && localStyles.pressedContainer,
                    style,
                ]}
                // Mouse and touch are owned by the gesture above. react-native-web still fires
                // `onPress` from the trailing `click`, so a pointer press is filtered out here by
                // the timestamp; what is left is keyboard activation (Enter/Space), which keeps
                // plain tap-to-toggle semantics and never auto-submits — holding a key is not a
                // gesture, and dictation has to stay usable without one.
                onPress={() => {
                    if (Date.now() - gestureEndedAtRef.current < POINTER_CLICK_SUPPRESSION_MS) return
                    toggle()
                }}
                accessibilityLabel={translate(
                    cancelArmed ? 'Release to cancel' : phase === RAMBLE_PHASE_RECORDING ? 'Stop dictation' : 'Dictate'
                )}
                disabled={phase === RAMBLE_PHASE_PROCESSING}
            >
                {phase === RAMBLE_PHASE_PROCESSING ? (
                    <ActivityIndicator size={14} color={colors.Text03} />
                ) : (
                    <>
                        <Icon
                            // The finger is on top of this, so the swap is not the feedback — the
                            // ring and the card are. It matters for the frame after the release,
                            // and for a mouse hold, where the pointer does not hide the button.
                            name={cancelArmed ? 'trash-2' : 'mic'}
                            size={16}
                            color={
                                cancelArmed
                                    ? colors.UtilityRed300
                                    : phase === RAMBLE_PHASE_RECORDING
                                      ? colors.Red200
                                      : colors.Text03
                            }
                        />
                        {phase === RAMBLE_PHASE_RECORDING && (
                            <Text style={[styles.caption1, localStyles.elapsedText]}>
                                {formatRambleElapsed(elapsedSeconds)}
                            </Text>
                        )}
                    </>
                )}
            </TouchableOpacity>
        </>
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
    cancelArmedContainer: {
        backgroundColor: colors.UtilityRed100,
    },
    pressedContainer: {
        opacity: 0.5,
    },
    elapsedText: {
        color: colors.Red200,
        marginLeft: 4,
    },
})
