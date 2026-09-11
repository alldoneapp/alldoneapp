import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { createBotQuickTopic } from '../../utils/assistantHelper'
import { createCallPageContextSync, readCallPageContext } from './assistantCallPageContext'
import { createLiveCallConnection } from './assistantLiveConnection'
import { sanitizeCallDiagnostics } from '../../functions/WhatsApp/assistantCallDiagnostics'
import { beginMobileCallAudioSession, primeCallAudio } from './assistantCallAudio'
import { acquireVoiceMicrophone, createVoiceMicrophoneSelector } from './assistantVoiceMicrophone'
import { createInputLevelMonitor } from '../../hooks/rambleMicCapture'
import {
    RETURN_MIC_SETTLE_MS,
    beginNativeCallAudioSession,
    createSilentAudioKeepalive,
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

// Owned by the app-level provider, never by a page or composer.
export default function useAssistantVoiceCall() {
    const [status, setStatus] = useState(STATUS_IDLE)
    const [callName, setCallName] = useState('')
    const [error, setError] = useState('')
    const [microphoneLabel, setMicrophoneLabel] = useState('')
    const [needsAudioPlayback, setNeedsAudioPlayback] = useState(false)
    const [voiceSeconds, setVoiceSeconds] = useState(0)
    const [callSummary, setCallSummary] = useState(null)
    const contextSyncRef = useRef(null)
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
    const transmittedTrackRef = useRef(null)
    const firstInputSignalRef = useRef(false)
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
        const input = microphoneSelectorRef.current?.getSnapshot()
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
            inputLevelPermille: Math.round(Math.min(1, input?.level || 0) * 1000),
            inputMonitorReady: input?.available === true,
            inputSending: transmittedTrackRef.current?.enabled === true && callReadyRef.current && !endingRef.current,
        }
        diagnosticsRef.current.events.push({ event, ...row })
        if (diagnosticsRef.current.events.length > 24)
            diagnosticsRef.current.events = [
                ...diagnosticsRef.current.events.slice(0, 8),
                ...diagnosticsRef.current.events.slice(-16),
            ]
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
                if (callReadyRef.current) liveConnectionRef.current?.greet(translate('Hello, how can I help?'))
            }
        } catch (error) {
            if (error?.name !== 'AbortError' && mountedRef.current && audioElementRef.current === audio)
                setNeedsAudioPlayback(true)
        }
    }, [])

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
                captureDiagnostics('microphone_ended')
                requestMicRecovery()
            }
            track.onmute = () => {
                if (localStreamRef.current?.getAudioTracks()[0] !== track) return
                console.warn('[VoiceCall] Mic track muted by OS')
                captureDiagnostics('microphone_muted')
            }
            track.onunmute = () => {
                if (localStreamRef.current?.getAudioTracks()[0] !== track) return
                console.log('[VoiceCall] Mic track unmuted')
                captureDiagnostics('microphone_unmuted')
                stallCountRef.current = 0
                micCheckPendingRef.current = false
            }
        },
        [requestMicRecovery, captureDiagnostics]
    )

    // The capture stays live for local warm-up/metering. Only its independent
    // sender clone is muted until the provider and assistant controller are ready.
    const replaceMicrophoneSender = useCallback(async (pc, stream) => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
        if (!sender || peerConnectionRef.current !== pc) throw new Error('Call ended')
        const track = stream.getAudioTracks()[0].clone()
        const previous = sender.track
        track.enabled = callReadyRef.current && !endingRef.current
        try {
            await sender.replaceTrack(track)
            if (peerConnectionRef.current !== pc || endingRef.current) throw new Error('Call ended')
            transmittedTrackRef.current = track
            track.enabled = callReadyRef.current
            previous?.stop()
        } catch (error) {
            track.stop()
            throw error
        }
    }, [])

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
            await replaceMicrophoneSender(pc, newStream)
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
            startMicrophoneSelectionRef.current?.(newStream, capture.raw)
            if (mountedRef.current) setMicrophoneLabel(capture.deviceLabel)
            captureDiagnostics('microphone_changed')

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
    }, [attachTrackListeners, replaceMicrophoneSender, captureDiagnostics])

    startMicrophoneSelectionRef.current = (stream, raw = false) => {
        microphoneSelectorRef.current?.stop()
        const pc = peerConnectionRef.current
        microphoneSelectorRef.current = createVoiceMicrophoneSelector({
            stream,
            raw,
            isPaused: () => {
                if (peerConnectionRef.current !== pc || endingRef.current || isDocumentHidden()) return true
                const output = outputMonitorRef.current
                output?.sample()
                if (output?.getLevel() > 0.008) lastOutputAudioRef.current = Date.now()
                return Date.now() - lastOutputAudioRef.current < 700
            },
            onSample: input => {
                if (!firstInputSignalRef.current && input.level >= 0.008) {
                    firstInputSignalRef.current = true
                    captureDiagnostics('microphone_first_signal')
                }
            },
            onBeforeRepair: selected => {
                if (localStreamRef.current === selected && peerConnectionRef.current === pc) {
                    transmittedTrackRef.current?.stop()
                    captureDiagnostics('microphone_recovering')
                }
            },
            onSwitch: async selected => {
                if (micRecoveringRef.current) throw new Error('Microphone recovery in progress')
                micRecoveringRef.current = true
                try {
                    await replaceMicrophoneSender(pc, selected)
                    if (peerConnectionRef.current !== pc) return
                    localStreamRef.current = selected
                    attachTrackListeners(selected.getAudioTracks()[0])
                    if (mountedRef.current) setMicrophoneLabel(selected.getAudioTracks()[0]?.label || '')
                    captureDiagnostics('microphone_changed')
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
            contextSyncRef.current?.stop()
            contextSyncRef.current = null
            if (reason === 'account_changed') {
                callGenerationRef.current++
                clearTimeout(summaryTimerRef.current)
                setCallSummary(null)
                setError('')
                setCallName('')
            }
            const diagnostics = captureDiagnostics('cleanup', endReasonRef.current || reason)
            callReadyRef.current = false
            startingRef.current = false
            transmittedTrackRef.current?.stop()
            transmittedTrackRef.current = null
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
            if (sessionId && mountedRef.current && reason !== 'account_changed') {
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
            if (stream)
                stream.getTracks().forEach(track => {
                    if (track.readyState !== 'ended') track.stop()
                })
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
        if (transmittedTrackRef.current) transmittedTrackRef.current.enabled = false
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

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            clearTimeout(summaryTimerRef.current)
            cleanup(false, 'app_unmounted')
        }
    }, [cleanup])

    const startCall = useCallback(
        async ({ assistant, projectId, chatId, skipNavigationOnThreadCreate = true }) => {
            if (
                Platform.OS !== 'web' ||
                typeof window === 'undefined' ||
                startingRef.current ||
                peerConnectionRef.current
            )
                return
            if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
                setError(
                    translate('Browser voice calls are not supported here') ||
                        'Browser voice calls are not supported here'
                )
                return
            }

            setCallName(assistant?.displayName || '')
            startingRef.current = true
            endReasonRef.current = null
            diagnosticsRef.current = { startedAt: Date.now(), events: [] }
            captureDiagnostics('start')
            const generation = ++callGenerationRef.current
            callReadyRef.current = false
            playbackReadyRef.current = false
            lastOutputAudioRef.current = 0
            firstInputSignalRef.current = false
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
                    console.warn(
                        '[VoiceCall] iOS shell build has no audio background mode — call pauses when backgrounded'
                    )
                }

                const isCancelled = () => !mountedRef.current || peerConnectionRef.current !== pc || isDocumentHidden()
                const capture = await acquireVoiceMicrophone({ isCancelled })
                const localStream = capture.stream
                localStreamRef.current = localStream
                setMicrophoneLabel(capture.deviceLabel)
                localStream.getTracks().forEach(track => {
                    const senderTrack = track.clone()
                    senderTrack.enabled = false
                    transmittedTrackRef.current = senderTrack
                    pc.addTrack(senderTrack, localStream)
                    attachTrackListeners(track)
                })
                startMicrophoneSelectionRef.current?.(localStream, capture.raw)
                captureDiagnostics('microphone_acquired')
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
                const pageContext = readCallPageContext()
                const result = await runHttpsCallableFunction(
                    'startAssistantBrowserCallSecondGen',
                    {
                        voiceProtocol: 'gpt-live-v2',
                        pageContext,
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
                if (result.sessionId)
                    contextSyncRef.current = createCallPageContextSync({
                        sessionId: result.sessionId,
                        initialContext: pageContext,
                        publish: data => runHttpsCallableFunction('updateAssistantBrowserCallContextSecondGen', data),
                        onError: () => captureDiagnostics('page_context_update_failed'),
                    })

                await pc.setRemoteDescription({ type: 'answer', sdp: result.answerSdp })
                if (result.voiceProvider === 'gpt-live') await connection.waitUntilReady()
                else {
                    connection.dispose()
                    liveConnectionRef.current = null
                }
                await microphoneSelectorRef.current?.whenPrepared()
                if (!mountedRef.current || peerConnectionRef.current !== pc || endingRef.current) return
                captureDiagnostics('microphone_prepared')
                callReadyRef.current = true
                if (transmittedTrackRef.current) transmittedTrackRef.current.enabled = true
                captureDiagnostics('microphone_sent')

                if (playbackReadyRef.current) connection.greet(translate('Hello, how can I help?'))
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
                    await runHttpsCallableFunction('endAssistantBrowserCallSecondGen', {
                        sessionId: ownSessionId,
                    }).catch(() => {})
                if (!mountedRef.current || generation !== callGenerationRef.current) return
                cleanup(true, 'startup_failed')
                if (e?.message !== 'voice_start_cancelled')
                    setError(e?.message || translate('Could not start assistant call'))
            }
        },
        [
            cleanup,
            clearDisconnectTimer,
            armDisconnectTimer,
            acquireWakeLock,
            playCallAudio,
            attachTrackListeners,
            startMicHealthMonitor,
            captureDiagnostics,
            endCall,
        ]
    )

    const getMicrophoneSnapshot = useCallback(
        () => ({
            ...microphoneSelectorRef.current?.getSnapshot(),
            label: localStreamRef.current?.getAudioTracks()[0]?.label || '',
            sending: callReadyRef.current && !endingRef.current && transmittedTrackRef.current?.enabled === true,
        }),
        []
    )

    return {
        status,
        error,
        microphoneLabel,
        getMicrophoneSnapshot,
        needsAudioPlayback,
        voiceSeconds,
        callSummary,
        callName,
        startCall,
        endCall,
        playCallAudio,
        cleanup,
        dismissError: () => setError(''),
    }
}
