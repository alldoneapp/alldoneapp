import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { createBotQuickTopic } from '../../utils/assistantHelper'
import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Spinner from './Spinner'
import {
    BACKGROUND_SUPPORT_FOREGROUND_ONLY,
    RETURN_MIC_SETTLE_MS,
    beginNativeCallAudioSession,
    createSilentAudioKeepalive,
    describeBackgroundCallSupport,
    destroySilentAudioKeepalive,
    endNativeCallAudioSession,
    isDocumentHidden,
    resolveDisconnectGraceMs,
    setupMediaSession,
    shouldRecoverMicNow,
    teardownMediaSession,
} from './assistantCallBackground'

const STATUS_IDLE = 'idle'
const STATUS_CONNECTING = 'connecting'
const STATUS_CONNECTED = 'connected'
const ICE_GATHERING_TIMEOUT_MS = 5000

// How often (ms) to poll RTCPeerConnection.getStats() looking for a stalled
// outbound audio track — i.e. the mic has been suspended by the OS.
const MIC_HEALTH_POLL_MS = 4000

// Number of consecutive polls with zero bytes-sent delta before we consider
// the mic dead and attempt to re-acquire it.
const MIC_STALL_THRESHOLD = 2

function waitForIceGatheringComplete(pc) {
    if (!pc || pc.iceGatheringState === 'complete') return Promise.resolve()

    return new Promise(resolve => {
        let settled = false
        const timeout = setTimeout(done, ICE_GATHERING_TIMEOUT_MS)

        function done() {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            pc.removeEventListener('icegatheringstatechange', handleChange)
            resolve()
        }

        function handleChange() {
            if (pc.iceGatheringState === 'complete') done()
        }

        pc.addEventListener('icegatheringstatechange', handleChange)
    })
}

// The call survives the app going to the background differently on every
// platform (native audio session on the iOS shell, Chrome's own capture
// notification on Android, a running tab on desktop, nothing at all in an iOS
// browser). The rules the component follows are spelled out in
// ./assistantCallBackground.js; this file only wires them to the peer
// connection's lifecycle.
export default function AssistantVoiceCallButton({
    compact = false,
    buttonStyle,
    titleStyle,
    textStyle,
    iconStyle,
    assistant = null,
    projectId = null,
    variant = 'button',
    title = null,
    skipNavigationOnThreadCreate = true,
}) {
    const [status, setStatus] = useState(STATUS_IDLE)
    const [error, setError] = useState('')
    const peerConnectionRef = useRef(null)
    const localStreamRef = useRef(null)
    const audioElementRef = useRef(null)
    const mountedRef = useRef(true)
    const wakeLockRef = useRef(null)
    const disconnectTimerRef = useRef(null)
    const micHealthTimerRef = useRef(null)
    const returnMicCheckTimerRef = useRef(null)
    const prevBytesSentRef = useRef(0)
    const stallCountRef = useRef(0)
    const micRecoveringRef = useRef(false)
    // Set when the mic looked dead while the page was hidden. A hidden page must
    // never reopen the microphone; the check is replayed once we are visible.
    const micCheckPendingRef = useRef(false)
    const silentKeepaliveRef = useRef(null)
    const nativeAudioSessionRef = useRef(false)
    // Stable ref for the mic-recovery function so that track listeners and the
    // health-monitor interval always call the latest version without circular
    // useCallback dependencies.
    const attemptMicRecoveryRef = useRef(null)
    const cleanupRef = useRef(null)

    // Acquire a Screen Wake Lock so the device does not sleep while a call is
    // active.  This is best-effort — the API may not be available everywhere.
    const acquireWakeLock = useCallback(async () => {
        try {
            if (navigator?.wakeLock) {
                wakeLockRef.current = await navigator.wakeLock.request('screen')
                wakeLockRef.current.addEventListener('release', () => {
                    wakeLockRef.current = null
                })
            }
        } catch (_) {
            // Non-critical — ignore if the browser denies the lock.
        }
    }, [])

    const releaseWakeLock = useCallback(() => {
        if (wakeLockRef.current) {
            wakeLockRef.current.release().catch(() => {})
            wakeLockRef.current = null
        }
    }, [])

    const clearDisconnectTimer = useCallback(() => {
        if (disconnectTimerRef.current) {
            clearTimeout(disconnectTimerRef.current)
            disconnectTimerRef.current = null
        }
    }, [])

    // Arm (or re-arm) the grace timer after which a still-not-connected peer
    // connection is treated as dead. The grace depends on visibility: a hidden
    // page gets a long one because ICE reports 'disconnected' on nearly every
    // background transition and recovers seconds later.
    const armDisconnectTimer = useCallback(
        pc => {
            clearDisconnectTimer()
            const graceMs = resolveDisconnectGraceMs({ hidden: isDocumentHidden() })
            disconnectTimerRef.current = setTimeout(() => {
                disconnectTimerRef.current = null
                if (pc.connectionState !== 'connected') cleanupRef.current?.()
            }, graceMs)
        },
        [clearDisconnectTimer]
    )

    // Ask for the mic to be checked/replaced. While hidden the request is only
    // remembered — getUserMedia is refused from a hidden page, and on iOS the
    // muted track comes back by itself on return.
    const requestMicRecovery = useCallback(() => {
        if (isDocumentHidden()) {
            micCheckPendingRef.current = true
            return
        }
        attemptMicRecoveryRef.current?.()
    }, [])

    // Attach mute/unmute/ended listeners to a mic track.  If the track ends
    // (e.g. OS revokes mic access), attempt recovery via the ref.
    const attachTrackListeners = useCallback(
        track => {
            if (!track) return
            track.onended = () => {
                console.warn('[VoiceCall] Mic track ended — attempting recovery')
                requestMicRecovery()
            }
            track.onmute = () => {
                console.warn('[VoiceCall] Mic track muted by OS')
            }
            track.onunmute = () => {
                console.log('[VoiceCall] Mic track unmuted')
                stallCountRef.current = 0
                micCheckPendingRef.current = false
            }
        },
        [requestMicRecovery]
    )

    // ------------------------------------------------------------------
    // Mic health monitor — detects when the OS suspends the mic track
    // and attempts to re-acquire it via getUserMedia + replaceTrack.
    // ------------------------------------------------------------------
    const attemptMicRecovery = useCallback(async () => {
        const pc = peerConnectionRef.current
        if (!pc || micRecoveringRef.current) return
        if (isDocumentHidden()) {
            micCheckPendingRef.current = true
            return
        }
        micRecoveringRef.current = true
        micCheckPendingRef.current = false
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            const newTrack = newStream.getAudioTracks()[0]
            if (!newTrack) return

            // Replace the dead track on the RTCPeerConnection sender — no
            // renegotiation needed.
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
            if (sender) {
                await sender.replaceTrack(newTrack)
            }

            // Stop old tracks and update the ref.
            const oldStream = localStreamRef.current
            if (oldStream) {
                oldStream.getTracks().forEach(t => {
                    if (t !== newTrack) t.stop()
                })
            }
            localStreamRef.current = newStream

            // Attach event listeners on the fresh track.
            attachTrackListeners(newTrack)

            // Reset stall counter.
            prevBytesSentRef.current = 0
            stallCountRef.current = 0
            console.log('[VoiceCall] Mic recovered after OS suspension')
        } catch (e) {
            console.warn('[VoiceCall] Mic recovery failed:', e?.message)
        } finally {
            micRecoveringRef.current = false
        }
    }, [attachTrackListeners])

    // Keep the ref in sync so track listeners always call the latest version.
    attemptMicRecoveryRef.current = attemptMicRecovery

    const stopMicHealthMonitor = useCallback(() => {
        if (micHealthTimerRef.current) {
            clearInterval(micHealthTimerRef.current)
            micHealthTimerRef.current = null
        }
    }, [])

    const startMicHealthMonitor = useCallback(() => {
        stopMicHealthMonitor()
        prevBytesSentRef.current = 0
        stallCountRef.current = 0

        micHealthTimerRef.current = setInterval(async () => {
            const pc = peerConnectionRef.current
            if (!pc) return
            try {
                const stats = await pc.getStats()
                stats.forEach(report => {
                    if (report.type === 'outbound-rtp' && report.kind === 'audio') {
                        const delta = report.bytesSent - prevBytesSentRef.current
                        prevBytesSentRef.current = report.bytesSent
                        if (delta === 0) {
                            stallCountRef.current++
                            if (stallCountRef.current >= MIC_STALL_THRESHOLD) {
                                // A hidden page stalls legitimately on iOS (the
                                // track is muted, not dead) — remember and
                                // re-check on return instead of reopening the mic.
                                if (isDocumentHidden()) {
                                    micCheckPendingRef.current = true
                                } else {
                                    console.warn('[VoiceCall] Mic stall detected — attempting recovery')
                                    attemptMicRecoveryRef.current?.()
                                }
                            }
                        } else {
                            stallCountRef.current = 0
                        }
                    }
                })
            } catch (_) {
                /* stats unavailable — ignore */
            }
        }, MIC_HEALTH_POLL_MS)
    }, [stopMicHealthMonitor])

    const cleanup = useCallback(
        (resetState = true) => {
            clearDisconnectTimer()
            if (returnMicCheckTimerRef.current) {
                clearTimeout(returnMicCheckTimerRef.current)
                returnMicCheckTimerRef.current = null
            }
            micCheckPendingRef.current = false
            stopMicHealthMonitor()
            releaseWakeLock()
            teardownMediaSession()
            destroySilentAudioKeepalive(silentKeepaliveRef.current)
            silentKeepaliveRef.current = null

            const stream = localStreamRef.current
            if (stream) stream.getTracks().forEach(track => track.stop())
            localStreamRef.current = null

            const pc = peerConnectionRef.current
            if (pc) pc.close()
            peerConnectionRef.current = null

            const audio = audioElementRef.current
            if (audio) {
                audio.srcObject = null
                audio.remove()
            }
            audioElementRef.current = null

            // Release the native audio session AFTER the capture is stopped, so
            // the shell never deactivates a session the web view still records on.
            if (nativeAudioSessionRef.current) {
                nativeAudioSessionRef.current = false
                endNativeCallAudioSession()
            }

            if (resetState && mountedRef.current) {
                setStatus(STATUS_IDLE)
            }
        },
        [clearDisconnectTimer, releaseWakeLock, stopMicHealthMonitor]
    )
    cleanupRef.current = cleanup

    // Visibility transitions. Hidden: nothing is torn down — the peer connection,
    // the capture and the keepalive all stay up, and a pending disconnect grace
    // is re-armed with the long hidden value. Visible: re-acquire the wake lock
    // (browsers release it on hide), resume the keepalive AudioContext, nudge
    // the audio element, collapse a pending disconnect grace back to the short
    // value, and replay any mic check that was deferred while hidden.
    useEffect(() => {
        function handleVisibilityChange() {
            const pc = peerConnectionRef.current
            if (!pc) return

            if (document.visibilityState === 'hidden') {
                if (disconnectTimerRef.current) armDisconnectTimer(pc)
                return
            }

            acquireWakeLock()

            const keepalive = silentKeepaliveRef.current
            if (keepalive?.audioContext?.state === 'suspended') {
                keepalive.audioContext.resume().catch(() => {})
            }

            const audio = audioElementRef.current
            if (audio && audio.paused && audio.srcObject) {
                audio.play().catch(() => {})
            }

            if (disconnectTimerRef.current) armDisconnectTimer(pc)

            // Give the OS a moment to hand the original track back before we
            // decide it is dead and replace it.
            const stream = localStreamRef.current
            const track = stream?.getAudioTracks()[0]
            const looksDead = shouldRecoverMicNow({ hidden: false, track })
            if (micCheckPendingRef.current || looksDead) {
                if (returnMicCheckTimerRef.current) clearTimeout(returnMicCheckTimerRef.current)
                returnMicCheckTimerRef.current = setTimeout(() => {
                    returnMicCheckTimerRef.current = null
                    if (!peerConnectionRef.current) return
                    const currentTrack = localStreamRef.current?.getAudioTracks()[0]
                    if (shouldRecoverMicNow({ hidden: isDocumentHidden(), track: currentTrack })) {
                        attemptMicRecoveryRef.current?.()
                    } else {
                        micCheckPendingRef.current = false
                        stallCountRef.current = 0
                    }
                }, RETURN_MIC_SETTLE_MS)
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [acquireWakeLock, armDisconnectTimer])

    useEffect(
        () => () => {
            mountedRef.current = false
            cleanup(false)
        },
        [cleanup]
    )

    const startCall = useCallback(async () => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return
        if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
            setError(
                translate('Browser voice calls are not supported here') || 'Browser voice calls are not supported here'
            )
            return
        }

        setError('')
        setStatus(STATUS_CONNECTING)
        try {
            const pc = new window.RTCPeerConnection()
            peerConnectionRef.current = pc

            const audio = document.createElement('audio')
            audio.autoplay = true
            audio.style.display = 'none'
            document.body.appendChild(audio)
            audioElementRef.current = audio

            pc.ontrack = event => {
                audio.srcObject = event.streams[0]
            }

            // Only 'failed' and 'closed' are terminal on their own. A
            // 'disconnected' state gets a visibility-dependent grace (see
            // assistantCallBackground.js) and is re-evaluated when it ends.
            pc.onconnectionstatechange = () => {
                const state = pc.connectionState
                if (state === 'connected') {
                    clearDisconnectTimer()
                } else if (state === 'disconnected') {
                    if (!disconnectTimerRef.current) armDisconnectTimer(pc)
                } else if (state === 'failed' || state === 'closed') {
                    cleanup()
                }
            }

            // On the iOS shell the host app's audio session has to be a voice
            // chat BEFORE the web view opens the mic; the plugin also tells us
            // whether this build can carry the call in the background at all.
            const nativeSession = await beginNativeCallAudioSession()
            nativeAudioSessionRef.current = !!nativeSession
            if (nativeSession && nativeSession.backgroundAudio === false) {
                console.warn('[VoiceCall] iOS shell build has no audio background mode — call pauses when backgrounded')
            }

            const localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            localStreamRef.current = localStream
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream)
                attachTrackListeners(track)
            })
            pc.createDataChannel('oai-events')

            const topicData =
                assistant?.uid &&
                (await createBotQuickTopic(assistant, '', {
                    skipNavigation: skipNavigationOnThreadCreate,
                    enableAssistant: true,
                    projectId,
                }))
            if (!topicData?.chatId || !topicData?.projectId || !topicData?.assistantId) {
                throw new Error(
                    translate('Could not create assistant call topic') || 'Could not create assistant call topic'
                )
            }

            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            await waitForIceGatheringComplete(pc)
            const offerSdp = pc.localDescription?.sdp || offer.sdp

            const result = await runHttpsCallableFunction(
                'startAssistantBrowserCallSecondGen',
                {
                    offerSdp,
                    projectId: topicData.projectId,
                    chatId: topicData.chatId,
                    assistantId: topicData.assistantId,
                },
                { timeout: 60000 }
            )
            if (!result?.answerSdp) throw new Error('Missing WebRTC answer')

            await pc.setRemoteDescription({ type: 'answer', sdp: result.answerSdp })

            // Activate background-keepalive mechanisms.
            acquireWakeLock()
            const assistantName = assistant?.displayName
            setupMediaSession({
                title: assistantName
                    ? translate('Call with Assistant', { name: assistantName }) || `Call with ${assistantName}`
                    : translate('Voice call') || 'Voice call',
                onHangup: () => cleanupRef.current?.(),
            })
            silentKeepaliveRef.current = createSilentAudioKeepalive()
            startMicHealthMonitor()

            setStatus(STATUS_CONNECTED)
        } catch (e) {
            console.error('Assistant browser call failed:', e)
            cleanup()
            setError(e?.message || translate('Could not start assistant call') || 'Could not start assistant call')
        }
    }, [
        assistant,
        cleanup,
        clearDisconnectTimer,
        armDisconnectTimer,
        acquireWakeLock,
        attachTrackListeners,
        startMicHealthMonitor,
        projectId,
        skipNavigationOnThreadCreate,
    ])

    if (Platform.OS !== 'web') return null

    const idleTitle = title || translate('Start voice call') || translate('Call Anna')
    const isConnecting = status === STATUS_CONNECTING

    if (status === STATUS_CONNECTED) {
        const backgroundSupport = describeBackgroundCallSupport()
        const showForegroundHint = !compact && backgroundSupport.level === BACKGROUND_SUPPORT_FOREGROUND_ONLY
        return (
            <View style={[localStyles.connectedContainer, compact && localStyles.connectedContainerCompact]}>
                <Button
                    type="danger"
                    icon="phone-call"
                    onPress={cleanup}
                    buttonStyle={[localStyles.iconButton, buttonStyle]}
                    accessibilityLabel={translate('End assistant call')}
                    accessible
                />
                {showForegroundHint && (
                    <Text style={localStyles.foregroundHint} numberOfLines={2}>
                        {translate(
                            'Keep Alldone open during the call, this browser pauses the microphone in the background'
                        )}
                    </Text>
                )}
            </View>
        )
    }

    if (variant === 'link') {
        return (
            <View style={localStyles.container}>
                <TouchableOpacity
                    style={[localStyles.linkRow, buttonStyle]}
                    disabled={isConnecting}
                    onPress={startCall}
                    accessible
                    accessibilityLabel={idleTitle}
                >
                    {isConnecting ? (
                        <Spinner containerSize={24} spinnerSize={18} />
                    ) : (
                        <Icon name="phone-call" size={24} color={colors.Text03} style={iconStyle} />
                    )}
                    <Text style={[localStyles.linkText, textStyle]} numberOfLines={2}>
                        {isConnecting ? translate('Calling') : idleTitle}
                    </Text>
                </TouchableOpacity>
                {!!error && <Text style={localStyles.error}>{error}</Text>}
            </View>
        )
    }

    return (
        <View style={localStyles.container}>
            <Button
                type="ghost"
                icon={compact && isConnecting ? <Spinner containerSize={24} spinnerSize={18} /> : 'phone-call'}
                title={compact ? null : idleTitle}
                processing={!compact && isConnecting}
                processingTitle={translate('Calling')}
                disabled={isConnecting}
                onPress={startCall}
                buttonStyle={[compact ? localStyles.iconButton : localStyles.callButton, buttonStyle]}
                titleStyle={[localStyles.callTitle, titleStyle]}
                accessibilityLabel={idleTitle}
                accessible
            />
            {!!error && !compact && <Text style={localStyles.error}>{error}</Text>}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'flex-start',
    },
    connectedContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    connectedContainerCompact: {
        justifyContent: 'flex-end',
    },
    callButton: {
        height: 40,
        minHeight: 40,
    },
    iconButton: {
        width: 40,
        height: 40,
        minHeight: 40,
        paddingHorizontal: 8,
        marginLeft: 8,
    },
    callTitle: {
        fontSize: 14,
    },
    linkRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    linkText: {
        ...styles.body2,
        color: colors.Text03,
    },
    foregroundHint: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
        flexShrink: 1,
    },
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 4,
    },
})
