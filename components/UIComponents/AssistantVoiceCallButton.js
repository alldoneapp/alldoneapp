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
            setStatus(STATUS_CONNECTED)
        } catch (e) {
            console.error('Assistant browser call failed:', e)
            cleanup()
            setError(e?.message || translate('Could not start assistant call') || 'Could not start assistant call')
        }
    }, [assistant, cleanup, projectId, skipNavigationOnThreadCreate])

    const toggleMute = useCallback(() => {
        const nextMuted = !muted
        const stream = localStreamRef.current
        if (stream) stream.getAudioTracks().forEach(track => (track.enabled = !nextMuted))
        setMuted(nextMuted)
    }, [muted])

    if (Platform.OS !== 'web') return null

    const idleTitle = title || translate('Start voice call') || translate('Call Anna')
    const isConnecting = status === STATUS_CONNECTING

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
