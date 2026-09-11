import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { createBotQuickTopic } from '../../utils/assistantHelper'
import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import Spinner from './Spinner'
import { createLiveCallConnection } from './assistantLiveConnection'
import { sanitizeCallDiagnostics } from '../../functions/WhatsApp/assistantCallDiagnostics'
import { beginMobileCallAudioSession, primeCallAudio } from './assistantCallAudio'
import { acquireVoiceMicrophone, createVoiceMicrophoneSelector } from './assistantVoiceMicrophone'
import { createInputLevelMonitor } from '../../hooks/rambleMicCapture'
import {
    LIVE_GOLD_PER_MINUTE,
    LIVE_INITIALIZATION_SECONDS,
    calculateLiveVoiceGold,
} from '../../functions/WhatsApp/assistantLivePricing'
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
const STATUS_ENDING = 'ending'
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
    chatId = null,
    variant = 'button',
    title = null,
    skipNavigationOnThreadCreate = true,
}) {
    const [status, setStatus] = useState(STATUS_IDLE)
    const [error, setError] = useState('')
    const [microphoneLabel, setMicrophoneLabel] = useState('')
    const [needsAudioPlayback, setNeedsAudioPlayback] = useState(false)
    const [voiceSeconds, setVoiceSeconds] = useState(0)
    const [callSummary, setCallSummary] = useState(null)
    const callSessionIdRef = useRef(null)
    const summaryTimerRef = useRef(null)
    const liveConnectionRef = useRef(null)
    const endingRef = useRef(false)
    const callReadyRef = useRef(false)
    const startingRef = useRef(false)
    const microphoneSelectorRef = useRef(null)
    const startMicrophoneSelectionRef = useRef(null)
    const playbackReadyRef = useRef(false)
    const outputMonitorRef = useRef(null)
    const lastOutputAudioRef = useRef(0)
    const callGenerationRef = useRef(0)
    const peerConnectionRef = useRef(null)
    const localStreamRef = useRef(null)
    const audioElementRef = useRef(null)
    const releaseMobileAudioSessionRef = useRef(null)
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
    const diagnosticsRef = useRef({ startedAt: Date.now(), events: [] })
    const endReasonRef = useRef(null)
    const captureDiagnostics = useCallback((event, reason) => {
        const pc = peerConnectionRef.current
        const audio = audioElementRef.current
        const mic = localStreamRef.current?.getAudioTracks()?.[0]
        const row = {
            atMs: Date.now() - diagnosticsRef.current.startedAt,
            width: window.innerWidth,
            height: window.innerHeight,
            orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
            visibility: document.visibilityState,
            online: navigator.onLine,
            peerState: pc?.connectionState,
            iceState: pc?.iceConnectionState,
            dataChannelState: liveConnectionRef.current?.getChannelState(),
            audioPaused: audio?.paused,
            audioReadyState: audio?.readyState,
            audioPlaybackReady: playbackReadyRef.current,
            micMuted: mic?.muted,
            micEnabled: mic?.enabled,
            micReadyState: mic?.readyState,
            inputBytesSent: prevBytesSentRef.current,
        }
        diagnosticsRef.current.events.push({ event, ...row })
        diagnosticsRef.current.events = diagnosticsRef.current.events.slice(-24)
        return sanitizeCallDiagnostics({ reason, ...row, events: diagnosticsRef.current.events })
    }, [])
    useEffect(() => {
        const events = {
            resize: 'resize',
            orientationchange: 'orientation_change',
            online: 'online',
            offline: 'offline',
        }
        const handlers = Object.entries(events).map(([type, event]) => {
            const handler = () => {
                if (peerConnectionRef.current) captureDiagnostics(event)
            }
            window.addEventListener(type, handler)
            return [type, handler]
        })
        return () => handlers.forEach(([type, handler]) => window.removeEventListener(type, handler))
    }, [captureDiagnostics])

    const playCallAudio = useCallback(async () => {
        const audio = audioElementRef.current
        if (!audio?.srcObject) return
        try {
            await audio.play()
            if (mountedRef.current && audioElementRef.current === audio) {
                playbackReadyRef.current = true
                setNeedsAudioPlayback(false)
                if (callReadyRef.current)
                    liveConnectionRef.current?.greet(
                        translate('Hello, I am %{name}. How can I help you?', {
                            name: assistant?.displayName || translate('Assistant'),
                        })
                    )
            }
        } catch (error) {
            if (error?.name !== 'AbortError' && mountedRef.current && audioElementRef.current === audio)
                setNeedsAudioPlayback(true)
        }
    }, [assistant?.displayName])

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
                if (pc.connectionState !== 'connected') cleanupRef.current?.(true, 'disconnect_grace_expired')
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
                if (localStreamRef.current?.getAudioTracks()[0] !== track) return
                console.warn('[VoiceCall] Mic track ended — attempting recovery')
                requestMicRecovery()
            }
            track.onmute = () => {
                if (localStreamRef.current?.getAudioTracks()[0] !== track) return
                console.warn('[VoiceCall] Mic track muted by OS')
            }
            track.onunmute = () => {
                if (localStreamRef.current?.getAudioTracks()[0] !== track) return
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
        if (!pc || micRecoveringRef.current || endingRef.current || !callReadyRef.current) return
        if (isDocumentHidden()) {
            micCheckPendingRef.current = true
            return
        }
        micRecoveringRef.current = true
        micCheckPendingRef.current = false
        let recoveryStream
        try {
            const capture = await acquireVoiceMicrophone({
                isCancelled: () =>
                    peerConnectionRef.current !== pc ||
                    endingRef.current ||
                    !callReadyRef.current ||
                    isDocumentHidden(),
            })
            const newStream = capture.stream
            recoveryStream = newStream
            const newTrack = newStream.getAudioTracks()[0]
            if (!newTrack) return
            if (peerConnectionRef.current !== pc || endingRef.current || !callReadyRef.current) {
                newStream.getTracks().forEach(track => track.stop())
                return
            }

            // Replace the dead track on the RTCPeerConnection sender — no
            // renegotiation needed.
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
            if (sender) {
                await sender.replaceTrack(newTrack)
            }
            if (peerConnectionRef.current !== pc || endingRef.current || !callReadyRef.current) return

            // Stop old tracks and update the ref.
            const oldStream = localStreamRef.current
            if (oldStream) {
                oldStream.getTracks().forEach(t => {
                    if (t !== newTrack) t.stop()
                })
            }
            localStreamRef.current = newStream
            recoveryStream = null
            startMicrophoneSelectionRef.current?.(newStream)
            if (mountedRef.current) setMicrophoneLabel(capture.deviceLabel)

            // Attach event listeners on the fresh track.
            attachTrackListeners(newTrack)

            // Reset stall counter.
            prevBytesSentRef.current = 0
            stallCountRef.current = 0
            console.log('[VoiceCall] Mic recovered after OS suspension')
        } catch (e) {
            console.warn('[VoiceCall] Mic recovery failed:', e?.message)
        } finally {
            recoveryStream?.getTracks().forEach(track => track.stop())
            micRecoveringRef.current = false
        }
    }, [attachTrackListeners])

    startMicrophoneSelectionRef.current = stream => {
        microphoneSelectorRef.current?.stop()
        const pc = peerConnectionRef.current
        microphoneSelectorRef.current = createVoiceMicrophoneSelector({
            stream,
            isPaused: () => {
                if (
                    peerConnectionRef.current !== pc ||
                    endingRef.current ||
                    !callReadyRef.current ||
                    isDocumentHidden()
                )
                    return true
                const output = outputMonitorRef.current
                output?.sample()
                if (output?.getLevel() > 0.008) lastOutputAudioRef.current = Date.now()
                return Date.now() - lastOutputAudioRef.current < 700
            },
            onSwitch: async selected => {
                if (micRecoveringRef.current) throw new Error('Microphone recovery in progress')
                const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
                if (!sender || peerConnectionRef.current !== pc) throw new Error('Call ended')
                micRecoveringRef.current = true
                try {
                    await sender.replaceTrack(selected.getAudioTracks()[0])
                    if (peerConnectionRef.current !== pc) return
                    localStreamRef.current = selected
                    attachTrackListeners(selected.getAudioTracks()[0])
                    if (mountedRef.current) setMicrophoneLabel(selected.getAudioTracks()[0]?.label || '')
                } finally {
                    micRecoveringRef.current = false
                }
            },
        })
    }

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
            if (!pc || endingRef.current || !callReadyRef.current) return
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
        (resetState = true, reason = 'cleanup') => {
            const diagnostics = captureDiagnostics('cleanup', endReasonRef.current || reason)
            callReadyRef.current = false
            startingRef.current = false
            microphoneSelectorRef.current?.stop()
            microphoneSelectorRef.current = null
            outputMonitorRef.current?.close()
            outputMonitorRef.current = null
            playbackReadyRef.current = false
            const generation = callGenerationRef.current
            const sessionId = callSessionIdRef.current
            callSessionIdRef.current = null
            if (sessionId)
                runHttpsCallableFunction('endAssistantBrowserCallSecondGen', { sessionId, diagnostics }).catch(() => {})
            if (sessionId && mountedRef.current) {
                const readSummary = async attempt => {
                    try {
                        const summary = await runHttpsCallableFunction('getAssistantBrowserCallSummarySecondGen', {
                            sessionId,
                        })
                        if (!mountedRef.current || callSessionIdRef.current || callGenerationRef.current !== generation)
                            return
                        setCallSummary(summary)
                        if (!summary.settled && attempt < 10)
                            summaryTimerRef.current = setTimeout(() => readSummary(attempt + 1), 2000)
                    } catch (_) {
                        /* Gold history remains available if the summary cannot load. */
                    }
                }
                readSummary(0)
            }
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
            liveConnectionRef.current?.dispose()
            liveConnectionRef.current = null
            endingRef.current = false
            peerConnectionRef.current = null
            if (pc) pc.close()

            const audio = audioElementRef.current
            if (audio) {
                audio.srcObject = null
                audio.remove()
            }
            audioElementRef.current = null
            releaseMobileAudioSessionRef.current?.()
            releaseMobileAudioSessionRef.current = null

            // Release the native audio session AFTER the capture is stopped, so
            // the shell never deactivates a session the web view still records on.
            if (nativeAudioSessionRef.current) {
                nativeAudioSessionRef.current = false
                endNativeCallAudioSession()
            }

            if (resetState && mountedRef.current) {
                setStatus(STATUS_IDLE)
                setNeedsAudioPlayback(false)
            }
        },
        [clearDisconnectTimer, releaseWakeLock, stopMicHealthMonitor, captureDiagnostics]
    )
    cleanupRef.current = cleanup
    const endCall = useCallback(async () => {
        if (endingRef.current) return
        endReasonRef.current = 'user_hangup'
        endingRef.current = true
        setStatus(STATUS_ENDING)
        // Stop sending speech immediately, but retain transport until final usage.
        localStreamRef.current?.getAudioTracks().forEach(track => {
            track.enabled = false
        })
        const connection = liveConnectionRef.current
        const generation = callGenerationRef.current
        await connection?.close()
        if (generation === callGenerationRef.current) cleanup()
    }, [cleanup])

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
            captureDiagnostics('visibility_change')

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
                playCallAudio()
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
    }, [acquireWakeLock, armDisconnectTimer, playCallAudio, captureDiagnostics])

    useEffect(
        () => () => {
            clearTimeout(summaryTimerRef.current)
            mountedRef.current = false
            cleanup(false, 'component_unmounted')
        },
        [cleanup]
    )

    const startCall = useCallback(async () => {
        if (Platform.OS !== 'web' || typeof window === 'undefined' || startingRef.current || peerConnectionRef.current)
            return
        if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
            setError(
                translate('Browser voice calls are not supported here') || 'Browser voice calls are not supported here'
            )
            return
        }

        startingRef.current = true
        endReasonRef.current = null
        diagnosticsRef.current = { startedAt: Date.now(), events: [] }
        captureDiagnostics('start')
        const generation = ++callGenerationRef.current
        callReadyRef.current = false
        playbackReadyRef.current = false
        lastOutputAudioRef.current = 0
        setMicrophoneLabel('')
        setNeedsAudioPlayback(false)
        setError('')
        setVoiceSeconds(0)
        setCallSummary(null)
        clearTimeout(summaryTimerRef.current)
        setStatus(STATUS_CONNECTING)
        let ownSessionId = null
        try {
            releaseMobileAudioSessionRef.current = beginMobileCallAudioSession()
            const pc = new window.RTCPeerConnection()
            peerConnectionRef.current = pc

            const audio = document.createElement('audio')
            audio.onplaying = () => captureDiagnostics('audio_playing')
            audio.onwaiting = () => captureDiagnostics('audio_waiting')
            audio.onstalled = () => captureDiagnostics('audio_stalled')
            primeCallAudio(audio)
            audio.style.display = 'none'
            document.body.appendChild(audio)
            audioElementRef.current = audio

            pc.ontrack = event => {
                if (peerConnectionRef.current !== pc) return
                audio.srcObject = event.streams[0]
                outputMonitorRef.current?.close()
                outputMonitorRef.current = createInputLevelMonitor(event.streams[0])
                playCallAudio()
            }

            // Only 'failed' and 'closed' are terminal on their own. A
            // 'disconnected' state gets a visibility-dependent grace (see
            // assistantCallBackground.js) and is re-evaluated when it ends.
            pc.onconnectionstatechange = () => {
                if (peerConnectionRef.current !== pc) return
                const state = pc.connectionState
                captureDiagnostics('peer_state')
                if (state === 'connected') {
                    clearDisconnectTimer()
                } else if (state === 'disconnected') {
                    if (!disconnectTimerRef.current) armDisconnectTimer(pc)
                } else if (state === 'failed' || state === 'closed') {
                    cleanup(true, state === 'failed' ? 'peer_failed' : 'peer_closed')
                }
            }
            pc.oniceconnectionstatechange = () => captureDiagnostics('ice_state')

            // On the iOS shell the host app's audio session has to be a voice
            // chat BEFORE the web view opens the mic; the plugin also tells us
            // whether this build can carry the call in the background at all.
            const nativeSession = await beginNativeCallAudioSession()
            if (!mountedRef.current || peerConnectionRef.current !== pc) {
                if (nativeSession) await endNativeCallAudioSession()
                throw new Error('voice_start_cancelled')
            }
            nativeAudioSessionRef.current = !!nativeSession
            if (nativeSession && nativeSession.backgroundAudio === false) {
                console.warn('[VoiceCall] iOS shell build has no audio background mode — call pauses when backgrounded')
            }

            const isCancelled = () => !mountedRef.current || peerConnectionRef.current !== pc || isDocumentHidden()
            const capture = await acquireVoiceMicrophone({ isCancelled })
            const localStream = capture.stream
            localStreamRef.current = localStream
            setMicrophoneLabel(capture.deviceLabel)
            localStream.getTracks().forEach(track => {
                track.enabled = false
                pc.addTrack(track, localStream)
                attachTrackListeners(track)
            })
            const channel = pc.createDataChannel('oai-events')
            const connection = createLiveCallConnection(channel, {
                getControllerStatus: () =>
                    runHttpsCallableFunction('getAssistantBrowserCallSummarySecondGen', {
                        sessionId: callSessionIdRef.current,
                    }),
                onClosed: () => {
                    if (peerConnectionRef.current === pc) cleanupRef.current?.(true, 'provider_closed')
                },
                onError: error => {
                    if (peerConnectionRef.current !== pc) return
                    setError(translate('Could not start assistant call'))
                    cleanupRef.current?.(true, error.voiceReason || 'data_channel_error')
                },
                onUsage: usage => {
                    if (mountedRef.current && Number.isFinite(usage?.seconds)) setVoiceSeconds(usage.seconds)
                },
            })
            liveConnectionRef.current = connection

            const topicData =
                assistant?.uid &&
                (chatId
                    ? { chatId, projectId, assistantId: assistant.uid }
                    : await createBotQuickTopic(assistant, '', {
                          skipNavigation: skipNavigationOnThreadCreate,
                          enableAssistant: true,
                          projectId,
                      }))
            if (!topicData?.chatId || !topicData?.projectId || !topicData?.assistantId) {
                throw new Error(
                    translate('Could not create assistant call topic') || 'Could not create assistant call topic'
                )
            }

            if (isCancelled()) throw new Error('voice_start_cancelled')
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            await waitForIceGatheringComplete(pc)
            const offerSdp = pc.localDescription?.sdp || offer.sdp

            if (isCancelled()) throw new Error('voice_start_cancelled')
            const result = await runHttpsCallableFunction(
                'startAssistantBrowserCallSecondGen',
                {
                    voiceProtocol: 'gpt-live-v2',
                    offerSdp,
                    projectId: topicData.projectId,
                    chatId: topicData.chatId,
                    assistantId: topicData.assistantId,
                },
                { timeout: 60000 }
            )
            ownSessionId = result?.sessionId || null
            if (!result?.answerSdp) throw new Error('Missing WebRTC answer')
            if (isCancelled()) throw new Error('voice_start_cancelled')
            callSessionIdRef.current = result.sessionId || null

            await pc.setRemoteDescription({ type: 'answer', sdp: result.answerSdp })
            if (result.voiceProvider === 'gpt-live') await connection.waitUntilReady()
            else {
                connection.dispose()
                liveConnectionRef.current = null
            }
            if (!mountedRef.current || peerConnectionRef.current !== pc) return
            callReadyRef.current = true
            localStreamRef.current?.getAudioTracks().forEach(track => {
                track.enabled = true
            })

            startMicrophoneSelectionRef.current?.(localStreamRef.current)
            if (playbackReadyRef.current)
                connection.greet(
                    translate('Hello, I am %{name}. How can I help you?', {
                        name: assistant?.displayName || translate('Assistant'),
                    })
                )
            else playCallAudio()
            startingRef.current = false

            // Activate background-keepalive mechanisms.
            acquireWakeLock()
            const assistantName = assistant?.displayName
            setupMediaSession({
                title: assistantName
                    ? translate('Call with Assistant', { name: assistantName }) || `Call with ${assistantName}`
                    : translate('Voice call') || 'Voice call',
                onHangup: endCall,
            })
            silentKeepaliveRef.current = createSilentAudioKeepalive()
            startMicHealthMonitor()

            setStatus(STATUS_CONNECTED)
        } catch (e) {
            if (ownSessionId && ownSessionId !== callSessionIdRef.current)
                await runHttpsCallableFunction('endAssistantBrowserCallSecondGen', { sessionId: ownSessionId }).catch(
                    () => {}
                )
            if (!mountedRef.current || generation !== callGenerationRef.current) return
            cleanup(true, 'startup_failed')
            if (e?.message !== 'voice_start_cancelled')
                setError(e?.message || translate('Could not start assistant call'))
        }
    }, [
        assistant,
        cleanup,
        clearDisconnectTimer,
        armDisconnectTimer,
        acquireWakeLock,
        playCallAudio,
        attachTrackListeners,
        startMicHealthMonitor,
        captureDiagnostics,
        projectId,
        chatId,
        endCall,
        skipNavigationOnThreadCreate,
    ])

    if (Platform.OS !== 'web') return null

    const idleTitle = title || translate('Start voice call') || translate('Call Anna')
    const isConnecting = status === STATUS_CONNECTING
    // Keep cancellation inside the same 40px control so connecting never adds a second row.
    const connectingIcon = (
        <View style={localStyles.connectingIcon}>
            <Spinner containerSize={24} spinnerSize={24} containerColor="transparent" />
            <Icon name="x" size={12} color={colors.Text03} style={localStyles.cancelIcon} />
        </View>
    )

    const priceText = translate('Voice costs %{gold} Gold/min plus normal assistant usage', {
        gold: LIVE_GOLD_PER_MINUTE,
    })
    const summaryText =
        callSummary &&
        translate(
            callSummary.settled && callSummary.finalVoiceUsage
                ? 'Call cost: %{voice} Gold voice + %{assistant} Gold assistant'
                : 'Call usage so far: %{voice} Gold voice + %{assistant} Gold assistant',
            { voice: callSummary.voiceGold, assistant: callSummary.assistantGold }
        )
    const statusHint = error
    const hint = statusHint ? (
        <Text accessibilityLiveRegion="polite" style={[localStyles.error, compact && localStyles.compactHint]}>
            {statusHint}
        </Text>
    ) : null
    if (status === STATUS_CONNECTED || status === STATUS_ENDING) {
        const backgroundSupport = describeBackgroundCallSupport()
        const showForegroundHint = !compact && backgroundSupport.level === BACKGROUND_SUPPORT_FOREGROUND_ONLY
        return (
            <View style={[localStyles.connectedContainer, compact && localStyles.connectedContainerCompact]}>
                <Button
                    type="danger"
                    icon="phone-call"
                    onPress={endCall}
                    disabled={status === STATUS_ENDING}
                    buttonStyle={[localStyles.iconButton, buttonStyle]}
                    accessibilityLabel={translate('End assistant call')}
                    accessible
                />
                {needsAudioPlayback && (
                    <Button
                        type="ghost"
                        icon="volume-2"
                        onPress={playCallAudio}
                        title={compact ? null : translate('Enable call audio')}
                        accessibilityLabel={translate('Enable call audio')}
                        accessible
                    />
                )}
                {!!microphoneLabel && !compact && (
                    <Text style={localStyles.foregroundHint}>
                        {translate('Microphone: %{name}', { name: microphoneLabel })}
                    </Text>
                )}
                {!compact && (
                    <Text style={localStyles.foregroundHint}>
                        {translate('Voice usage: %{gold} Gold', { gold: calculateLiveVoiceGold(voiceSeconds) })}
                    </Text>
                )}
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
                    onPress={isConnecting ? endCall : startCall}
                    accessible
                    accessibilityLabel={
                        isConnecting ? translate('Cancel assistant call') : `${idleTitle}. ${priceText}`
                    }
                >
                    {isConnecting ? (
                        connectingIcon
                    ) : (
                        <Icon name="phone-call" size={24} color={colors.Text03} style={iconStyle} />
                    )}
                    <Text style={[localStyles.linkText, textStyle]} numberOfLines={2}>
                        {isConnecting ? translate('Calling') : idleTitle}
                    </Text>
                </TouchableOpacity>
                {!compact && <Text style={localStyles.foregroundHint}>{priceText}</Text>}
                {!compact && summaryText && <Text style={localStyles.foregroundHint}>{summaryText}</Text>}
                {!compact && (
                    <Text style={localStyles.foregroundHint}>
                        {translate('Voice has a %{seconds}-second minimum; connected time includes silence', {
                            seconds: LIVE_INITIALIZATION_SECONDS,
                        })}
                    </Text>
                )}
                {hint}
            </View>
        )
    }

    return (
        <View style={localStyles.container}>
            <Button
                type="ghost"
                icon={isConnecting ? connectingIcon : 'phone-call'}
                title={compact ? null : isConnecting ? translate('Calling') : idleTitle}
                onPress={isConnecting ? endCall : startCall}
                buttonStyle={[compact ? localStyles.iconButton : localStyles.callButton, buttonStyle]}
                titleStyle={[localStyles.callTitle, titleStyle]}
                accessibilityLabel={isConnecting ? translate('Cancel assistant call') : `${idleTitle}. ${priceText}`}
                accessible
            />
            {!compact && <Text style={localStyles.foregroundHint}>{priceText}</Text>}
            {!compact && summaryText && <Text style={localStyles.foregroundHint}>{summaryText}</Text>}
            {!compact && (
                <Text style={localStyles.foregroundHint}>
                    {translate('Voice has a %{seconds}-second minimum; connected time includes silence', {
                        seconds: LIVE_INITIALIZATION_SECONDS,
                    })}
                </Text>
            )}
            {hint}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'flex-start',
    },
    connectingIcon: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelIcon: {
        position: 'absolute',
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
    compactHint: {
        position: 'absolute',
        top: 44,
        right: 0,
        width: 240,
        padding: 8,
        backgroundColor: colors.White,
        borderRadius: 4,
        zIndex: 100,
    },
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 4,
    },
})
