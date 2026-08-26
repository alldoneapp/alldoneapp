import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Keyboard, StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import Button from '../../../UIControls/Button'
import Spinner from '../../../UIComponents/Spinner'
import AssistantAvatarButton from '../../../MyDayView/AssistantLine/AssistantOptions/AssistantAvatarButton'
import AssistantVoiceCallButton from '../../../UIComponents/AssistantVoiceCallButton'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import AttachmentDropZone from '../../../Feeds/CommentsTextInput/AttachmentDropZone'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import {
    getAssistantControlsStacked,
    getAssistantInputDisplayHeight,
    getAssistantInputLayout,
    INITIAL_ASSISTANT_INPUT_LAYOUT,
} from '../../../MyDayView/AssistantLine/assistantInputLayout'
import {
    assistantComposerHasMedia,
    getAssistantComposerMaxHeight,
} from '../../../MyDayView/AssistantLine/assistantComposerMedia'

// Same list the My Day line declares — see AssistantOptions for why the presence of `attachment` /
// `customImageFormat` is what actually switches attachment support on (AT-2441 / AT-2444).
const ASSISTANT_INPUT_ATTACHMENT_FORMATS = ['image', 'attachment', 'customImageFormat', 'videoFormat']

export default function AssistantInputLine({ assistant, projectId, noBottomMargin }) {
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const [message, setMessage] = useState('')
    const [isSending, setIsSending] = useState(false)
    const [inputLayout, setInputLayout] = useState(INITIAL_ASSISTANT_INPUT_LAYOUT)
    const [controlsStacked, setControlsStacked] = useState(false)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const [editor, setEditor] = useState(null)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const isSendingRef = useRef(false)
    const inputRef = useRef(null)
    const isShiftPressed = useRef(false)

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

    // A composer holding a dropped/pasted attachment may grow past the text cap so the image
    // preview is visible rather than clipped into a scroller (AT-2444).
    const composerMaxHeight = getAssistantComposerMaxHeight(assistantComposerHasMedia(message))

    const updateInputHeight = useCallback(
        contentHeight => {
            setInputLayout(previousLayout => getAssistantInputLayout(contentHeight, previousLayout, composerMaxHeight))
        },
        [composerMaxHeight]
    )

    const updateMessage = useCallback(text => {
        setMessage(text)
        if (!text) setInputLayout(INITIAL_ASSISTANT_INPUT_LAYOUT)
    }, [])

    const handleSendMessage = useCallback(
        async explicitText => {
            const trimmedMessage = (typeof explicitText === 'string' ? explicitText : message).trim()
            if (!trimmedMessage || isSendingRef.current || !assistant || !assistant.uid) return

            inputRef.current?.blur()
            Keyboard.dismiss()
            isSendingRef.current = true
            setIsSending(true)
            try {
                // AT-2444: upload dropped/pasted files and rewrite their `blob:` tokens to real
                // download URLs BEFORE the topic is created — the comment `createBotQuickTopic`
                // writes is the one `mediaContext` is derived from, which is how the assistant
                // gets to see the image. With no attachment tokens this takes no `await` at all.
                const messageToSend = await updateNewAttachmentsData(projectId, trimmedMessage)

                const topicData = await createBotQuickTopic(assistant, messageToSend, {
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
                setInputCursorIndex(0)
                // The rich editor is uncontrolled — clearing `message` alone leaves the text (and
                // any attachment embed) sitting in Quill, unlike the plain TextInput this replaced.
                inputRef.current?.clear()
                isSendingRef.current = false
                setIsSending(false)
            } catch (error) {
                console.error('Error sending assistant quick message:', error)
                isSendingRef.current = false
                setIsSending(false)
            }
        },
        [assistant, message, projectId]
    )

    // Enter-to-send, Shift+Enter for a newline — same handling as the My Day assistant line. It has
    // to be a document-level listener rather than the old `onKeyPress`: react-native-web's TextInput
    // is gone, and Quill owns the keystrokes inside the editor. The `mentionsModalActive` guard is
    // load-bearing — without it, Enter to pick a mention would send the message instead.
    const handleKeyDown = useCallback(
        event => {
            if (!inputRef.current?.isFocused?.()) return

            if (event.key === 'Enter' && !isShiftPressed.current && !mentionsModalActive && message.trim().length > 0) {
                event.preventDefault()
                handleSendMessage()
            }

            if (event.key === 'Shift') {
                isShiftPressed.current = true
            }
        },
        [handleSendMessage, mentionsModalActive, message]
    )

    const handleKeyUp = useCallback(event => {
        if (inputRef.current?.isFocused?.() && event.key === 'Shift') {
            isShiftPressed.current = false
        }
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown)
        document.addEventListener('keyup', handleKeyUp)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
            document.removeEventListener('keyup', handleKeyUp)
        }
    }, [handleKeyDown, handleKeyUp])

    // An image on its own is a complete message: the serialized embed token IS the text.
    const canSend = message.trim().length > 0 && !isSending
    const sendLabel = translate('Send')
    const sendButtonTitle = isMobile ? '' : sendLabel
    const sendButtonStyle = isMobile ? localStyles.sendButtonMobile : localStyles.sendButtonDesktop

    return (
        // AT-2444 — the whole card is the drop target, matching the My Day assistant line: the
        // field is a 40px line, so a drop on the avatar or the send button means the same thing.
        <AttachmentDropZone
            testID="assistant-input-line-attachment-drop-zone"
            style={[localStyles.container, noBottomMargin && { marginBottom: 8 }]}
            disabled={isSending}
            editor={editor}
            inputCursorIndex={inputCursorIndex}
            projectId={projectId}
            setInputCursorIndex={setInputCursorIndex}
        >
            <View style={localStyles.row}>
                <View style={localStyles.avatarWrapper}>
                    <AssistantAvatarButton assistant={assistant} size={40} />
                </View>
                <CustomTextInput3
                    ref={inputRef}
                    containerStyle={localStyles.messageInput}
                    fixedHeight={getAssistantInputDisplayHeight(inputLayout.height, controlsStacked, composerMaxHeight)}
                    maxHeight={composerMaxHeight}
                    onChangeText={updateMessage}
                    onContentSizeChange={(width, height) => updateInputHeight(height)}
                    placeholder={translate('Start a new chat')}
                    projectId={projectId}
                    styleTheme={TASK_THEME}
                    disabledEdition={isSending}
                    setMentionsModalActive={setMentionsModalActive}
                    setEditor={setEditor}
                    setInputCursorIndex={setInputCursorIndex}
                    otherFormats={ASSISTANT_INPUT_ATTACHMENT_FORMATS}
                    keepBreakLines={true}
                    scrollEnabled={inputLayout.scrollEnabled}
                    showScrollIndicator={inputLayout.scrollEnabled}
                    autoExpand={true}
                    // Pinned on, and push-to-talk wired up, exactly as on the My Day assistant line
                    // (AT-2355 / AT-2405): these are the same composer and should not differ.
                    alwaysShowDictation={true}
                    onDictationSubmit={text => text && handleSendMessage(text)}
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
        </AttachmentDropZone>
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
