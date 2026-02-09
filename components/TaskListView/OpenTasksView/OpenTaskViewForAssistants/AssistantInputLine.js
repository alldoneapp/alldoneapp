import React, { useRef, useState, useCallback } from 'react'
import { StyleSheet, View, TextInput } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import Button from '../../../UIControls/Button'
import Spinner from '../../../UIComponents/Spinner'
import AssistantAvatarButton from '../../../MyDayView/AssistantLine/AssistantOptions/AssistantAvatarButton'

export default function AssistantInputLine({ assistant, projectId, noBottomMargin }) {
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const [message, setMessage] = useState('')
    const [isSending, setIsSending] = useState(false)
    const [inputHeight, setInputHeight] = useState(40)
    const isSendingRef = useRef(false)

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
            setInputHeight(40)
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
                    style={[localStyles.messageInput, { height: inputHeight }]}
                    value={message}
                    onChangeText={setMessage}
                    placeholder={translate('Start a new chat with the assistant')}
                    placeholderTextColor={colors.Text03}
                    editable={!isSending}
                    autoCorrect={true}
                    multiline={true}
                    onKeyPress={handleKeyPress}
                    onContentSizeChange={e => {
                        const h = e.nativeEvent.contentSize.height
                        setInputHeight(Math.min(Math.max(h, 40), 120))
                    }}
                />
                <View style={localStyles.sendButtonWrapper}>
                    <Button
                        title={isSending ? null : sendButtonTitle}
                        icon={isSending ? <Spinner spinnerSize={18} color={'white'} /> : 'send'}
                        onPress={handleSendMessage}
                        disabled={!canSend}
                        buttonStyle={sendButtonStyle}
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
    sendButtonWrapper: {
        justifyContent: 'center',
        alignItems: 'center',
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
