import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'

const STATUS_IDLE = 'idle'
const STATUS_CONNECTING = 'connecting'
const STATUS_CONNECTED = 'connected'

export default function AssistantVoiceCallButton({ compact = false, buttonStyle }) {
    const [status, setStatus] = useState(STATUS_IDLE)
    const [muted, setMuted] = useState(false)
    const [error, setError] = useState('')
    const peerConnectionRef = useRef(null)
    const localStreamRef = useRef(null)
    const audioElementRef = useRef(null)
    const mountedRef = useRef(true)

    const cleanup = useCallback((resetState = true) => {
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
            setMuted(false)
            setStatus(STATUS_IDLE)
        }
    }, [])

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
            pc.onconnectionstatechange = () => {
                if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) cleanup()
            }

            const localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            localStreamRef.current = localStream
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream))
            pc.createDataChannel('oai-events')

            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)

            const result = await runHttpsCallableFunction(
                'startAssistantBrowserCallSecondGen',
                { offerSdp: offer.sdp },
                { timeout: 60000 }
            )
            if (!result?.answerSdp) throw new Error('Missing WebRTC answer')

            await pc.setRemoteDescription({ type: 'answer', sdp: result.answerSdp })
            setStatus(STATUS_CONNECTED)
        } catch (e) {
            console.error('Assistant browser call failed:', e)
            cleanup()
            setError(e?.message || translate('Could not start assistant call') || 'Could not start assistant call')
        }
    }, [cleanup])

    const toggleMute = useCallback(() => {
        const nextMuted = !muted
        const stream = localStreamRef.current
        if (stream) stream.getAudioTracks().forEach(track => (track.enabled = !nextMuted))
        setMuted(nextMuted)
    }, [muted])

    if (Platform.OS !== 'web') return null

    if (status === STATUS_CONNECTED) {
        return (
            <View style={[localStyles.connectedContainer, compact && localStyles.connectedContainerCompact]}>
                <Button
                    type="ghost"
                    icon={muted ? 'mic-off' : 'mic'}
                    onPress={toggleMute}
                    buttonStyle={[localStyles.iconButton, buttonStyle]}
                    accessibilityLabel={muted ? translate('Unmute assistant call') : translate('Mute assistant call')}
                    accessible
                />
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

    return (
        <View style={localStyles.container}>
            <Button
                type="ghost"
                icon="phone-call"
                title={compact ? null : translate('Call Anna')}
                processing={status === STATUS_CONNECTING}
                processingTitle={compact ? '' : translate('Calling')}
                disabled={status === STATUS_CONNECTING}
                onPress={startCall}
                buttonStyle={[compact ? localStyles.iconButton : localStyles.callButton, buttonStyle]}
                titleStyle={localStyles.callTitle}
                accessibilityLabel={translate('Call Anna')}
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
    error: {
        ...styles.caption2,
        color: colors.UtilityRed200,
        marginTop: 4,
    },
})
