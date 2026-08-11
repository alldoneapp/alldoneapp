import React, { useRef, useState, useCallback, useEffect } from 'react'
import { StyleSheet, View, TextInput } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import Button from '../../../UIControls/Button'
import Spinner from '../../../UIComponents/Spinner'
import AssistantAvatarButton from '../../../MyDayView/AssistantLine/AssistantOptions/AssistantAvatarButton'
import AssistantVoiceCallButton from '../../../UIComponents/AssistantVoiceCallButton'
import {
    getAssistantControlsStacked,
    getAssistantInputDisplayHeight,
    getAssistantInputLayout,
    INITIAL_ASSISTANT_INPUT_LAYOUT,
} from '../../../MyDayView/AssistantLine/assistantInputLayout'

export default function AssistantInputLine({ assistant, projectId, noBottomMargin }) {
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const [message, setMessage] = useState('')
    const [isSending, setIsSending] = useState(false)
    const [inputLayout, setInputLayout] = useState(INITIAL_ASSISTANT_INPUT_LAYOUT)
    const [controlsStacked, setControlsStacked] = useState(false)
    const isSendingRef = useRef(false)

    // Same rule as the My Day assistant line: once the field grows past one
    // line the voice and send buttons stack directly below each other, and the
    // field expands into the width that frees up. Released only when the field
    // is emptied, so the width change can never feed back into the wrapping.
    useEffect(() => {
        setControlsStacked(wasStacked =>
            getAssistantControlsStacked({
                inputHeight: inputLayout.height,
                hasText: message.length > 0,
                wasStacked,
            })
        )
    }, [inputLayout.height, message])

    const updateInputHeight = useCallback(contentHeight => {
        setInputLayout(previousLayout => getAssistantInputLayout(contentHeight, previousLayout))
    }, [])

    const handleSendMessage = useCallback(async () => {
        const trimmedMessage = message.trim()
        if (!trimmedMessage || isSendingRef.current || !assistant || !assistant.uid) return

        isSendingRef.current = true
        setIsSending(true)
        try {
            const topicData = await createBotQuickTopic(assistant, trimmedMessage, {
                skipNavigation: false,
                enableAssistant: true,
                projectId,
            })

            if (!topicData) {
                isSendingRef.current = false
                setIsSending(false)
                return
            }

            setMessage('')
            setInputLayout(INITIAL_ASSISTANT_INPUT_LAYOUT)
            isSendingRef.current = false
            setIsSending(false)
        } catch (error) {
            console.error('Error sending assistant quick message:', error)
            isSendingRef.current = false
            setIsSending(false)
        }
    }, [assistant, message, projectId])

    const handleKeyPress = useCallback(
        e => {
            if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault()
                handleSendMessage()
            }
        },
        [handleSendMessage]
    )

    const canSend = message.trim().length > 0 && !isSending
    const sendLabel = translate('Send')
    const sendButtonTitle = isMobile ? '' : sendLabel
    const sendButtonStyle = isMobile ? localStyles.sendButtonMobile : localStyles.sendButtonDesktop

    return (
        <View style={[localStyles.container, noBottomMargin && { marginBottom: 8 }]}>
            <View style={localStyles.row}>
                <View style={localStyles.avatarWrapper}>
                    <AssistantAvatarButton assistant={assistant} size={40} />
                </View>
                <TextInput
                    style={[
                        localStyles.messageInput,
                        { height: getAssistantInputDisplayHeight(inputLayout.height, controlsStacked) },
                        !inputLayout.scrollEnabled && localStyles.messageInputExpanding,
                    ]}
                    value={message}
                    onChangeText={setMessage}
                    placeholder={translate('Start a new chat')}
                    placeholderTextColor={colors.Text03}
                    editable={!isSending}
                    autoCorrect={true}
                    multiline={true}
                    scrollEnabled={inputLayout.scrollEnabled}
                    onKeyPress={handleKeyPress}
                    onContentSizeChange={e => {
                        updateInputHeight(e.nativeEvent.contentSize.height)
                    }}
                />
                <View
                    testID={'assistant-message-controls'}
                    style={[localStyles.sendButtonWrapper, controlsStacked && localStyles.sendButtonWrapperExpanded]}
                >
                    <AssistantVoiceCallButton
                        compact
                        assistant={assistant}
                        projectId={projectId}
                        buttonStyle={[localStyles.voiceButton, controlsStacked && localStyles.voiceButtonExpanded]}
                    />
                    <Button
                        title={isSending ? null : sendButtonTitle}
                        icon={isSending ? <Spinner spinnerSize={18} color={'white'} /> : 'send'}
                        onPress={handleSendMessage}
                        disabled={!canSend}
                        buttonStyle={[sendButtonStyle, controlsStacked && localStyles.sendButtonStacked]}
                        titleStyle={localStyles.sendButtonTitle}
                        accessibilityLabel={sendLabel}
                        accessible={true}
                    />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: colors.Grey200,
        marginTop: 8,
        borderRadius: 4,
        marginBottom: 24,
        paddingLeft: 10,
        paddingRight: 16,
        paddingVertical: 14,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        width: '100%',
    },
    avatarWrapper: {
        marginRight: 12,
    },
    messageInput: {
        flex: 1,
        marginRight: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey300,
        backgroundColor: 'white',
        minHeight: 40,
        maxHeight: 120,
        paddingVertical: 8,
        paddingHorizontal: 12,
        fontSize: 14,
        lineHeight: 22,
        color: colors.Text01,
        textAlignVertical: 'top',
    },
    messageInputExpanding: {
        overflow: 'hidden',
        overflowY: 'hidden',
    },
    sendButtonWrapper: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonWrapperExpanded: {
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    voiceButton: {
        marginLeft: 0,
        marginRight: 8,
    },
    voiceButtonExpanded: {
        marginRight: 0,
        marginBottom: 8,
    },
    sendButtonStacked: {
        // Overrides Button's own alignSelf: 'flex-start' so the send button
        // stays on the shared centre axis with the voice button above it.
        alignSelf: 'center',
    },
    sendButtonDesktop: {
        paddingHorizontal: 16,
        paddingVertical: 0,
        height: 40,
        minHeight: 40,
    },
    sendButtonMobile: {
        paddingHorizontal: 8,
        paddingVertical: 0,
        height: 40,
        minHeight: 40,
    },
    sendButtonTitle: {
        fontSize: 14,
    },
})
