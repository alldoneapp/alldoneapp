import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { createBotQuickTopic } from '../../utils/assistantHelper'
import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Spinner from './Spinner'

const STATUS_IDLE = 'idle'
const STATUS_CONNECTING = 'connecting'
const STATUS_CONNECTED = 'connected'
const ICE_GATHERING_TIMEOUT_MS = 5000

// Delay before treating a 'disconnected' ICE state as terminal.
// WebRTC frequently reports 'disconnected' transiently when the browser tab
// goes into the background; it usually recovers within a few seconds.
const DISCONNECTED_GRACE_MS = 8000

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

// ---------------------------------------------------------------------------
// Media Session helper — registers the call as an active media session so
// Android treats the browser tab as a media-producing foreground activity.
// This makes the OS less likely to suspend the audio pipeline on lock screen.
// ---------------------------------------------------------------------------
function setupMediaSession(assistantName) {
    try {
        if (!('mediaSession' in navigator)) return
        navigator.mediaSession.metadata = new MediaMetadata({
            title: assistantName
                ? translate('Call with %s', assistantName) || `Call with ${assistantName}`
                : translate('Voice call') || 'Voice call',
            artist: 'Alldone',
            album: '',
        })
        navigator.mediaSession.playbackState = 'playing'
        // Register no-op action handlers so the OS shows media controls.
        const actions = ['play', 'pause', 'stop']
        actions.forEach(action => {
            try {
                navigator.mediaSession.setActionHandler(action, () => {})
            } catch (_) {
                /* handler not supported — fine */
            }
        })
    } catch (_) {
        /* Non-critical */
    }
}

function teardownMediaSession() {
    try {
        if (!('mediaSession' in navigator)) return
        navigator.mediaSession.metadata = null
        navigator.mediaSession.playbackState = 'none'
    } catch (_) {
        /* ignore */
    }
}

// ---------------------------------------------------------------------------
// Silent audio keepalive — plays a near-silent looping audio signal so the
// browser maintains an "active media playback" session.  Android gives higher
// priority to tabs with active audio, reducing the chance the OS suspends the
// mic when the screen locks.
// ---------------------------------------------------------------------------
function createSilentAudioKeepalive() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        // Tiny-gain oscillator: inaudible but keeps AudioContext alive.
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        gain.gain.value = 0.001 // near-silent
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.start()
        return { audioContext: ctx, oscillator, gainNode: gain }
    } catch (_) {
        return null
    }
}

function destroySilentAudioKeepalive(keepalive) {
    if (!keepalive) return
    try {
        keepalive.oscillator.stop()
    } catch (_) {
        /* ignore */
    }
    try {
        keepalive.audioContext.close()
    } catch (_) {
        /* ignore */
    }
}

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
    const prevBytesSentRef = useRef(0)
    const stallCountRef = useRef(0)
    const micRecoveringRef = useRef(false)
    const silentKeepaliveRef = useRef(null)
    // Stable ref for the mic-recovery function so that track listeners and the
    // health-monitor interval always call the latest version without circular
    // useCallback dependencies.
    const attemptMicRecoveryRef = useRef(null)

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

    // Attach mute/unmute/ended listeners to a mic track.  If the track ends
    // (e.g. OS revokes mic access), attempt recovery via the ref.
    const attachTrackListeners = useCallback(track => {
        if (!track) return
        track.onended = () => {
            console.warn('[VoiceCall] Mic track ended — attempting recovery')
            attemptMicRecoveryRef.current?.()
        }
        track.onmute = () => {
            console.warn('[VoiceCall] Mic track muted by OS')
        }
        track.onunmute = () => {
            console.log('[VoiceCall] Mic track unmuted')
            stallCountRef.current = 0
        }
    }, [])

    // ------------------------------------------------------------------
    // Mic health monitor — detects when Android suspends the mic track
    // and attempts to re-acquire it via getUserMedia + replaceTrack.
    // ------------------------------------------------------------------
    const attemptMicRecovery = useCallback(async () => {
        const pc = peerConnectionRef.current
        if (!pc || micRecoveringRef.current) return
        micRecoveringRef.current = true
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
                                console.warn('[VoiceCall] Mic stall detected — attempting recovery')
                                attemptMicRecoveryRef.current?.()
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
            if (disconnectTimerRef.current) {
                clearTimeout(disconnectTimerRef.current)
                disconnectTimerRef.current = null
            }
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
            if (resetState && mountedRef.current) {
                setStatus(STATUS_IDLE)
            }
        },
        [releaseWakeLock, stopMicHealthMonitor]
    )

    // When the page becomes visible again after being backgrounded, re-acquire
    // the wake lock (browsers release it automatically on visibility:hidden),
    // resume the AudioContext keepalive, nudge the audio element, and check if
    // the mic track needs recovery.
    useEffect(() => {
        function handleVisibilityChange() {
            if (document.visibilityState === 'visible') {
                const pc = peerConnectionRef.current
                if (!pc) return

                // Re-acquire wake lock released by the browser on hide.
                acquireWakeLock()

                // Resume the silent AudioContext if it was suspended.
                const keepalive = silentKeepaliveRef.current
                if (keepalive?.audioContext?.state === 'suspended') {
                    keepalive.audioContext.resume().catch(() => {})
                }

                // Nudge the audio element — some browsers pause it in background.
                const audio = audioElementRef.current
                if (audio && audio.paused && audio.srcObject) {
                    audio.play().catch(() => {})
                }

                // Check whether the mic track is still alive.  If it has ended
                // or is muted (OS-level), attempt to re-acquire immediately
                // rather than waiting for the next health poll.
                const stream = localStreamRef.current
                if (stream) {
                    const track = stream.getAudioTracks()[0]
                    if (track && (track.readyState === 'ended' || track.muted)) {
                        attemptMicRecovery()
                    }
                }
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [acquireWakeLock, attemptMicRecovery])

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

            // Handle connection state changes with a grace period for transient
            // 'disconnected' states.  Browsers commonly fire 'disconnected'
            // when the tab moves to the background; the ICE agent usually
            // recovers within seconds.  Only 'failed' and 'closed' are terminal.
            pc.onconnectionstatechange = () => {
                const state = pc.connectionState
                if (state === 'connected') {
                    // Recovered — cancel any pending disconnect timer.
                    if (disconnectTimerRef.current) {
                        clearTimeout(disconnectTimerRef.current)
                        disconnectTimerRef.current = null
                    }
                } else if (state === 'disconnected') {
                    // Start a grace timer; if the connection does not recover
                    // within DISCONNECTED_GRACE_MS we treat it as terminal.
                    if (!disconnectTimerRef.current) {
                        disconnectTimerRef.current = setTimeout(() => {
                            disconnectTimerRef.current = null
                            if (pc.connectionState !== 'connected') cleanup()
                        }, DISCONNECTED_GRACE_MS)
                    }
                } else if (state === 'failed' || state === 'closed') {
                    cleanup()
                }
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
            setupMediaSession(assistant?.displayName)
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
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 4,
    },
})
