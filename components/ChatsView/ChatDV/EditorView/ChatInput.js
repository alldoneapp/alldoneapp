import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import { firebase } from '@firebase/app'
import ReactQuill from 'react-quill'

import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { colors } from '../../../styles/global'
import { processPastedTextWithBreakLines, TASK_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { STAYWARD_COMMENT, updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import { MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'
import { translate } from '../../../../i18n/TranslationService'
import { updateXpByCommentInChat } from '../../../../utils/Levels'
import Backend from '../../../../utils/BackendBridge'
import { checkIsLimitedByXp } from '../../../Premium/PremiumHelper'
import {
    setAssistantEnabled,
    setDisableAutoFocusInChat,
    setMainChatEditor,
    setQuotedNoteText,
    setQuotedText,
} from '../../../../redux/actions'
import ChatInputButtons from './ChatInputButtons'
import { CHAT_INPUT_LIMIT_IN_CHARACTERS } from '../../../../utils/assistantHelper'
import { createObjectMessage } from '../../../../utils/backends/Chats/chatsComments'

const Delta = ReactQuill.Quill.import('delta')

export default function ChatInput({
    chat,
    editing,
    initialText,
    projectId,
    chatTitle,
    members,
    containerStyle,
    messageId,
    closeEditMode,
    creatorId,
    setWaitingForBotAnswer,
    creatorData,
    assistantId,
    objectType,
    setAmountOfNewCommentsToHighligth,
    onMessageSent,
}) {
    const dispatch = useDispatch()
    const isMentionModalOpen = useSelector(state => state.openModals[MENTION_MODAL_ID])
    const quotedNoteText = useSelector(state => state.quotedNoteText)
    const quotedText = useSelector(state => state.quotedText)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const gold = useSelector(state => state.loggedUser.gold)
    const disableAutoFocusInChat = useSelector(state => state.disableAutoFocusInChat)
    const assistantEnabled = useSelector(state => state.assistantEnabled)
    const [chatEditor, setChatEditor] = useState(null)
    const [inputText, setInputText] = useState('')
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [showRunOutGoalModal, setShowRunOutGoalModal] = useState(false)
    const inputRef = useRef(null)
    const isShiftPressed = useRef(false)

    const { id: objectId, type: chatType } = chat

    const disabledEdition = editing && loggedUserId !== creatorId

    const updateEditor = editor => {
        if (!editing) dispatch(setMainChatEditor(editor))
        setChatEditor(editor)
    }

    useEffect(() => {
        if (!editing) {
            return () => {
                dispatch(setMainChatEditor(null))
            }
        }
    }, [])

    const onEdit = event => {
        if (disabledEdition || initialText.trim() === inputText.trim()) {
            closeEditMode()
        } else {
            event?.preventDefault?.()
            updateNewAttachmentsData(projectId, inputText).then(commentWithAttachments => {
                createObjectMessage(
                    projectId,
                    objectId,
                    commentWithAttachments,
                    chatType,
                    chatType === 'tasks' ? STAYWARD_COMMENT : null,
                    messageId,
                    initialText
                )
            })
            setAmountOfNewCommentsToHighligth(0)
            closeEditMode()
        }
    }

    const onSubmit = event => {
        event?.preventDefault?.()
        if (assistantEnabled && gold === 0) {
            setShowRunOutGoalModal(true)
            dispatch(setAssistantEnabled(false))
        } else {
            if (!checkIsLimitedByXp(projectId)) {
                inputRef.current.clear()

                if (assistantEnabled) setWaitingForBotAnswer(true)

                // Re-enable auto-scroll when user sends a message
                if (onMessageSent) onMessageSent()

                updateNewAttachmentsData(projectId, inputText).then(commentWithAttachments => {
                    createObjectMessage(
                        projectId,
                        objectId,
                        commentWithAttachments,
                        chatType,
                        chatType === 'tasks' ? STAYWARD_COMMENT : null,
                        null,
                        null
                    )
                })
                setAmountOfNewCommentsToHighligth(0)
                updateXpByCommentInChat(loggedUserId, firebase, Backend.getDb(), projectId)
            }
        }
    }

    const onKeyDown = event => {
        if (inputRef.current.isFocused()) {
            if (event.key === 'Enter' && !isShiftPressed.current && !!inputText && !isMentionModalOpen) {
                editing ? onEdit(event) : onSubmit(event)
            }
            if (event.key === 'Shift') {
                isShiftPressed.current = true
            }
        }
    }

    const onKeyUp = event => {
        if (inputRef.current.isFocused()) {
            if (event.key === 'Shift') {
                isShiftPressed.current = false
            }
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('keyup', onKeyUp)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('keyup', onKeyUp)
        }
    })

    useEffect(() => {
        return () => {
            if (!editing) {
                setTimeout(() => {
                    dispatch(setQuotedNoteText(''))
                })
                dispatch(setQuotedText(null))
            }
        }
    }, [])

    useEffect(() => {
        if (disableAutoFocusInChat) {
            setTimeout(() => {
                inputRef.current?.blur()
            })
            dispatch(setDisableAutoFocusInChat(false))
        }
    }, [disableAutoFocusInChat])

    useEffect(() => {
        setTimeout(() => {
            if (!disableAutoFocusInChat) inputRef.current?.focus()
        })

        if (chatEditor && quotedText) {
            const regex = /\[quote\](.*?)\[quote\]/g
            const HELPER_KEY = '4FFG345GKSL23834MDF47SDF83JSDFKCNM27234SFKK475'

            let cleanedText = quotedText.text.replaceAll('\n', HELPER_KEY)
            cleanedText = cleanedText.replaceAll(regex, '')
            cleanedText = cleanedText.replaceAll(HELPER_KEY, '\n')
            cleanedText = cleanedText.replaceAll('\n\n', '\n').trim()

            const text = `[quote][header]${quotedText.userName}[header]\n${cleanedText}[quote]`
            const delta = processPastedTextWithBreakLines(
                text,
                Delta,
                projectId,
                inputRef.current.getEditorId(),
                loggedUserId,
                false,
                null,
                chatEditor,
                false,
                null,
                false
            )
            chatEditor.setContents(delta)
            chatEditor.updateContents({ ops: [{ retain: chatEditor.getLength() }, { insert: '\n' }] })
            chatEditor.setSelection(chatEditor.getLength(), 0)
        }
    }, [quotedText])

    const handlePerplexityResponse = (editor, content) => {
        if (!editor || !content) {
            console.log('handlePerplexityResponse: Missing editor or content', {
                hasEditor: !!editor,
                hasContent: !!content,
            })
            return
        }

        console.log('handlePerplexityResponse: Processing content:', content)
        const Delta = ReactQuill.Quill.import('delta')
        const delta = new Delta()

        // The content should already be in HTML format from the PerplexityClient
        // We just need to ensure it's properly formatted for Quill
        console.log('Converting content to Quill delta format...')
        const tempDelta = editor.clipboard.convert(content)
        console.log('Converted delta:', tempDelta)

        // Process each operation in the delta
        tempDelta.ops.forEach((op, index) => {
            console.log(`Processing delta operation ${index}:`, op)
            if (op.insert) {
                // Handle code blocks
                if (op.attributes && op.attributes['code-block']) {
                    console.log('Processing code block:', op.insert)
                    delta.insert(op.insert, { 'code-block': true })
                }
                // Handle inline code
                else if (op.attributes && op.attributes.code) {
                    console.log('Processing inline code:', op.insert)
                    delta.insert(op.insert, { code: true })
                }
                // Handle links
                else if (op.attributes && op.attributes.link) {
                    console.log('Processing link:', { text: op.insert, link: op.attributes.link })
                    delta.insert(op.insert, { link: op.attributes.link })
                }
                // Handle other formatted text
                else {
                    console.log('Processing formatted text:', { text: op.insert, attributes: op.attributes || {} })
                    delta.insert(op.insert, op.attributes || {})
                }
            }
        })

        // Ensure proper spacing
        if (!content.endsWith('\n')) {
            console.log('Adding trailing newline')
            delta.insert('\n')
        }

        // Update the editor content
        console.log('Final delta to be applied:', delta)
        editor.updateContents(delta, 'user')
        console.log('Editor content updated')
    }

    return (
        <View style={[localStyles.inputContainer, containerStyle]}>
            <CustomTextInput3
                ref={inputRef}
                placeholder={translate('Type to add new comment')}
                placeholderTextColor={colors.Text03}
                onChangeText={text => setInputText(text.trim())}
                autoFocus={disableAutoFocusInChat}
                projectId={projectId}
                externalAlignment={localStyles.textInputAlignment}
                containerStyle={localStyles.textInputContainer}
                styleTheme={TASK_THEME}
                setInputCursorIndex={setInputCursorIndex}
                setEditor={updateEditor}
                otherFormats={['image', 'attachment', 'customImageFormat', 'videoFormat']}
                disabledEdition={disabledEdition}
                initialTextExtended={initialText || quotedNoteText}
                keepBreakLines={true}
                characterLimit={CHAT_INPUT_LIMIT_IN_CHARACTERS}
                setShowRunOutGoalModal={setShowRunOutGoalModal}
                chatAssistantData={{ objectId, objectAssistantId: assistantId, objectType: chatType }}
            />
            <ChatInputButtons
                projectId={projectId}
                chatTitle={chatTitle}
                members={members}
                onSubmit={editing ? onEdit : onSubmit}
                inputText={inputText}
                inputCursorIndex={inputCursorIndex}
                editor={chatEditor}
                initialText={initialText}
                editing={editing}
                disabledEdition={disabledEdition}
                closeEditMode={closeEditMode}
                creatorId={creatorId}
                inputRef={inputRef}
                setShowRunOutGoalModal={setShowRunOutGoalModal}
                showRunOutGoalModal={showRunOutGoalModal}
                creatorData={creatorData}
                assistantId={assistantId}
                objectId={chat.id}
                objectType={objectType}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    inputContainer: {
        bottom: 24,
        left: 0,
        right: 0,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: colors.Grey200,
        borderRadius: 4,
        shadowColor: 'rgba(0,0,0,0.08)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 8,
    },
    textInputContainer: {
        marginTop: 2,
        marginBottom: 12,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
        minHeight: 40, // 59 - (7 + 12)
        marginLeft: 17,
        marginRight: 40,
    },
    textInputAlignment: {
        paddingLeft: 0,
        paddingRight: 0,
    },
})
