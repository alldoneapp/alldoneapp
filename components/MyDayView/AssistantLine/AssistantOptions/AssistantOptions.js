import React, { useCallback, useEffect, useState, useRef } from 'react'
import { Keyboard, StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'

import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import { getAssistantLineData } from './helper'
import AssistantAvatarButton from './AssistantAvatarButton'
import AssistantSwitchControl from '../AssistantSwitchControl'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
// The canonical, dependency-free definition of the key — deliberately not the re-export from
// `chatsComments`, which would drag the whole comments backend into this composer.
import { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } from '../../../../utils/backends/Chats/chatNotificationPriority'
import {
    beginAssistantLineSend,
    endAssistantLineSend,
    failAssistantLineSend,
    markAssistantLineSendCreated,
} from '../assistantLinePendingSend'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import '../assistantInput.css'
import { TASK_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import AttachmentDropZone from '../../../Feeds/CommentsTextInput/AttachmentDropZone'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import AssistantTaskSearchButtonWrapper from './Search/AssistantTaskSearchButtonWrapper'
import AssistantVoiceCallButton from '../../../UIComponents/AssistantVoiceCallButton'
import { RAGE_LAUNCH_ANCHOR_ID } from '../../../RageMode/rageLaunchAnchor'
import {
    ASSISTANT_COMPOSER_BOX_PADDING_BOTTOM,
    ASSISTANT_COMPOSER_BOX_PADDING_TOP,
    ASSISTANT_COMPOSER_TOOLBAR_GAP,
    ASSISTANT_HEADER_GAP,
    ASSISTANT_HEADER_HEIGHT,
    ASSISTANT_INPUT_VERTICAL_PADDING,
    ASSISTANT_TOOLBAR_CONTROL_SIZE,
    getAssistantInputLayout,
    INITIAL_ASSISTANT_INPUT_LAYOUT,
} from '../assistantInputLayout'
import { assistantComposerHasMedia, getAssistantComposerMaxHeight } from '../assistantComposerMedia'
import { handleComposerFieldMouseDown } from '../assistantComposerFocus'

import { themed } from '../../../../Themes/colorMode'

// The formats an attachment-capable input must declare. `CustomTextInput3.supportsAttachments`
// keys on `attachment` / `customImageFormat` being present, and that predicate is what installs
// `quill.appManagedFileUpload` — so without this list a drop is inserted by Quill's own uploader
// as an unserializable base64 embed that vanishes on submit (AT-2441), and a paste does the same.
const ASSISTANT_INPUT_ATTACHMENT_FORMATS = ['image', 'attachment', 'customImageFormat', 'videoFormat']

/**
 * The assistant line: a compact header (avatar, the assistant's name — which is also the switcher
 * when there is more than one assistant to talk to — and the greeting), then one composer box.
 * The box is a multi-line text field with a toolbar under it: + (attach) and Templates on the
 * left; mic, call and send on the right. The + and the mic belong to the text field
 * (CustomTextInput3 owns their insert/push-to-talk wiring) and are portalled into the toolbar's
 * slots through `inlineControlTargets`.
 */
export default function AssistantOptions({
    headerControls = null,
    assistantSwitch = null,
    projectOverride = null,
    assistantIdOverride = null,
    preferAssistantIdOverride = false,
}) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProjectFromStore = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const selectedProject = projectOverride || selectedProjectFromStore
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const gold = useSelector(state => state.loggedUser.gold)
    const [message, setMessage] = useState('')
    const [showRunOutOfGoldModal, setShowRunOutOfGoldModal] = useState(false)
    const [inputLayout, setInputLayout] = useState(INITIAL_ASSISTANT_INPUT_LAYOUT)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    // AT-2444: the live Quill instance and caret the drop zone inserts at. The zone stays disabled
    // until `setEditor` has handed the editor over, so an early drop can never be half-applied.
    const [editor, setEditor] = useState(null)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    // The toolbar slots the text field portals its + and mic into. State, not refs: the field
    // has to re-render once the nodes exist.
    const [attachmentSlot, setAttachmentSlot] = useState(null)
    const [dictationSlot, setDictationSlot] = useState(null)
    const isSendingRef = useRef(false)
    const inputRef = useRef(null)
    const isShiftPressed = useRef(false)

    const assistantId = assistantIdOverride || defaultAssistantId

    const { assistant, assistantProject, assistantProjectId } = getAssistantLineData(
        selectedProject,
        assistantId,
        defaultProjectId,
        preferAssistantIdOverride
    )
    // The assistant can live in another project, but conversations started from
    // this line must inherit the project the user currently has selected.
    const conversationProject = selectedProjectFromStore || selectedProject || assistantProject
    const conversationProjectId = conversationProject?.id || assistantProjectId

    // Puts a submission back the way it was. Only reached when the send failed: the rich editor is
    // uncontrolled, so `setMessage` alone would leave Quill empty while `canSend` claimed there was
    // something to send.
    const restoreComposer = useCallback(text => {
        setMessage(text)
        inputRef.current?.clearAndSetContent(text)
    }, [])

    // `explicitText` is the push-to-talk path (AT-2405): a dictation that submits itself hands over
    // the composer text it just wrote, because the `message` state behind it is still a queued
    // setState at that point and reading it here would send the pre-dictation draft.
    const handleSendMessage = useCallback(
        async explicitText => {
            const trimmedMessage = (typeof explicitText === 'string' ? explicitText : message).trim()
            if (!trimmedMessage || isSendingRef.current || !assistant || !assistant.uid) return

            if (gold <= 0) {
                setShowRunOutOfGoldModal(true)
                return
            }

            // AT-2504 — the composer empties FIRST and the send finishes in the background.
            //
            // It used to clear only after `updateNewAttachmentsData` AND `createBotQuickTopic` had
            // both resolved, and the second of those is two round trips (the
            // `createBotQuickTopicSecondGen` callable, then the `createObjectMessage` write). So
            // the text the user had just pressed Enter on sat there, greyed out and un-editable,
            // for the whole of it — the app looked like it had not registered the keystroke.
            //
            // Nothing below needs the editor's contents: `trimmedMessage` is already captured, and
            // `updateNewAttachmentsData` re-uploads from the `blob:` URLs inside that STRING, which
            // stay alive until the document is unloaded (nothing here revokes them). So clearing
            // early cannot cost an attachment.
            //
            // `isSendingRef` stays, but now only spans this synchronous block: it is the guard
            // against one keystroke being handled twice, not a lock on the composer. Sending a
            // second message while the first is still being created is allowed and creates its own
            // topic, exactly as two sends always did.
            isSendingRef.current = true
            let pendingSendId = null
            try {
                inputRef.current?.blur()
                Keyboard.dismiss()
                setMessage('')
                setInputLayout(INITIAL_ASSISTANT_INPUT_LAYOUT)
                setInputCursorIndex(0)
                inputRef.current?.clear()

                // Filed under the keys the real pointer will be written under, so the progress card
                // appears in the same Last comment slot the answer will land in.
                pendingSendId = beginAssistantLineSend({
                    keys: [conversationProjectId, ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY],
                    projectId: conversationProjectId,
                    assistantId: assistant.uid,
                    assistantName: assistant.displayName,
                    text: trimmedMessage,
                })
            } finally {
                isSendingRef.current = false
            }

            try {
                // AT-2444: a dropped or pasted file is only a `blob:` object URL in the editor
                // until here — this is the step that uploads it to Storage and rewrites the token
                // to the real download URL, exactly as the chat composer does before
                // `createObjectMessage`. It must run BEFORE the topic is created: the comment
                // `createBotQuickTopic` writes is the one that gets its `mediaContext` extracted
                // from this text, and that is how the assistant gets to see the image at all.
                //
                // Called unconditionally, like ChatInput: with no attachment tokens the helper
                // takes no `await` at all, so its loading-spinner refcount opens and closes in the
                // same tick and a plain text send is not delayed or made async by it.
                const messageToSend = await updateNewAttachmentsData(conversationProjectId, trimmedMessage)

                const topicData = await createBotQuickTopic(assistant, messageToSend, {
                    skipNavigation: true,
                    enableAssistant: true,
                    projectId: conversationProjectId,
                    // `createObjectMessage` starts the assistant callable after writing the user's
                    // comment, then returns without waiting for the run. If that callable fails,
                    // is cancelled, or completes without posting, the line and any open thread
                    // must stop claiming the assistant is still working.
                    onAssistantRunSettled: () => endAssistantLineSend(pendingSendId),
                })

                if (!topicData) {
                    // `createBotQuickTopic` returns undefined only when it could not resolve a
                    // project to write into — nothing was sent, so give the text back.
                    failAssistantLineSend(pendingSendId)
                    restoreComposer(trimmedMessage)
                    return
                }

                // The thread exists and carries the user's comment. What is left is the assistant's
                // answer, and the Last comment slot says so until it arrives.
                //
                // AT-2523 — the title travels with the chat id because the Last comment card is now
                // a door into this thread, and the popover it opens names the object it is
                // commenting on. It is also what releases a tap the user made while the topic was
                // still being created.
                markAssistantLineSendCreated(pendingSendId, topicData.chatId, topicData.title)
            } catch (error) {
                console.error('❌ [AssistantOptions] Error sending assistant quick message:', error)
                failAssistantLineSend(pendingSendId)
                restoreComposer(trimmedMessage)
            }
        },
        [assistant, conversationProjectId, message, gold, restoreComposer]
    )

    // A composer holding an attachment is allowed to grow past the text cap so the image it is
    // previewing is actually visible (AT-2444). Derived from the serialized text rather than from
    // a separate attachment state, so it cannot drift from what will be submitted.
    const composerHasMedia = assistantComposerHasMedia(message)
    const composerMaxHeight = getAssistantComposerMaxHeight(composerHasMedia)

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

    // AT-3028: the field's padding edges focus the composer too. Scoped to the field wrapper, and
    // guarded against the + / mic that are portalled out of it (assistantComposerFocus.js).
    const handleFieldMouseDown = useCallback(event => {
        handleComposerFieldMouseDown(event, inputRef.current)
    }, [])

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

    if (!assistant || !assistant.uid || !assistantProject) {
        return null
    }

    // An image on its own is a complete message — the serialized embed token IS the text, so this
    // is already non-empty for an attachment-only composer and needs no separate condition.
    //
    // AT-2504: there is no `&& !isSending` term. The composer empties synchronously on submit, so
    // an in-flight send already leaves this false through `message`, and a SECOND message typed
    // while the first is still being created is deliberately allowed — it gets its own topic.
    const canSend = message.trim().length > 0
    const sendLabel = translate('Send')

    return (
        // AT-2444 — the whole assistant card is the drop target, not just the field: dropping onto
        // the avatar, the toolbar or the header all mean the same thing.
        //
        // The zone must stay a CAPTURE-phase claim (see AttachmentDropZone): Quill's own uploader
        // listens on `quill.root`, a descendant of this node, so a bubble-phase handler here would
        // run second and the file would land twice.
        <AttachmentDropZone
            testID="assistant-line-attachment-drop-zone"
            style={localStyles.container}
            editor={editor}
            inputCursorIndex={inputCursorIndex}
            projectId={conversationProjectId}
            setInputCursorIndex={setInputCursorIndex}
        >
            <View testID="assistant-line-header" style={localStyles.headerRow}>
                {headerControls ? <View style={localStyles.headerSide}>{headerControls}</View> : null}
                <View style={localStyles.headerCenter}>
                    {/* Rage mode's Anna takes off from this avatar when the game is started from a
                        screen that also shows the assistant line (rageLaunchAnchor.js). */}
                    <View style={localStyles.avatarWrapper} nativeID={RAGE_LAUNCH_ANCHOR_ID}>
                        <AssistantAvatarButton
                            projectIndex={assistantProject.index}
                            assistant={assistant}
                            size={32}
                            radius={8}
                        />
                    </View>
                    {assistantSwitch ? (
                        <AssistantSwitchControl
                            {...assistantSwitch}
                            label={assistant.displayName}
                            labelStyle={localStyles.nameText}
                        />
                    ) : (
                        <Text style={localStyles.nameText} numberOfLines={1}>
                            {assistant.displayName}
                        </Text>
                    )}
                    {/* Kept short on purpose (AT-2442): the header is a single centred line, so a
                        longer greeting ellipsises on narrow phones. */}
                    <Text style={localStyles.greetingText} numberOfLines={1}>
                        {translate('How can I help?')}
                    </Text>
                </View>
            </View>
            <View testID="assistant-composer-row" style={localStyles.composerBox}>
                {/* AT-3028 — the whole two-line field is a click target for typing: the editor
                    fills both lines (assistantInput.css) and this wrapper hands its padding edges
                    to the editor. The toolbar below is outside it and keeps its own clicks. */}
                <View testID="assistant-composer-field" onMouseDown={handleFieldMouseDown}>
                    <CustomTextInput3
                        ref={inputRef}
                        containerStyle={localStyles.messageInput}
                        fixedHeight={inputLayout.height}
                        maxHeight={composerMaxHeight}
                        onChangeText={updateMessage}
                        // Include the field's own vertical padding in the natural height.
                        onContentSizeChange={(width, height) =>
                            updateInputHeight(height + ASSISTANT_INPUT_VERTICAL_PADDING)
                        }
                        placeholder={isMobile ? `${translate('New message')} …` : translate('Start a new chat')}
                        projectId={conversationProjectId}
                        styleTheme={TASK_THEME}
                        setMentionsModalActive={setMentionsModalActive}
                        // In object editors an assistant selection is a command to change that
                        // object's assistant, so CustomTextInput3 inserts a profile link. Here it is
                        // message content: preserve the selected assistant id in a real @-mention so
                        // comment parsing and the assistant runtime can detect it (AT-2592).
                        insertAssistantAsMention={true}
                        // AT-2444: hands the live editor + caret to the drop zone above, and declares
                        // the attachment formats. Declaring them is also what gives this composer
                        // image PASTE, since CustomTextInput3 gates `appManagedFileUpload` on them.
                        setEditor={setEditor}
                        setInputCursorIndex={setInputCursorIndex}
                        otherFormats={ASSISTANT_INPUT_ATTACHMENT_FORMATS}
                        keepBreakLines={true}
                        scrollEnabled={inputLayout.scrollEnabled}
                        showScrollIndicator={inputLayout.scrollEnabled}
                        autoExpand={true}
                        // Dictating is a primary way to use this composer, so the mic is pinned on
                        // instead of waiting for hover/focus — on touch there is no hover (AT-2355).
                        alwaysShowDictation={true}
                        showAttachmentButton={true}
                        inlineControlTargets={{ attachment: attachmentSlot, dictation: dictationSlot }}
                        toolbarControlStyle={localStyles.toolbarControl}
                        // Push-to-talk (AT-2405): hold the mic, speak, release — the transcript is
                        // inserted and the message is sent. Enter's own guards still apply, since this
                        // is the same send path the keydown listener uses.
                        onDictationSubmit={text => text && handleSendMessage(text)}
                    />
                </View>
                <View testID="assistant-composer-toolbar" style={localStyles.toolbar}>
                    <View style={localStyles.toolbarSide}>
                        <View ref={setAttachmentSlot} style={localStyles.controlSlot} />
                        <AssistantTaskSearchButtonWrapper
                            preferredAssistantId={assistant.uid}
                            preferredProjectId={conversationProjectId}
                        />
                    </View>
                    <AppPopover
                        content={<RunOutOfGoldAssistantModal closeModal={() => setShowRunOutOfGoldModal(false)} />}
                        align={'end'}
                        position={['top', 'bottom', 'left', 'right']}
                        onClickOutside={() => setShowRunOutOfGoldModal(false)}
                        isOpen={showRunOutOfGoldModal}
                        contentLocation={isMobile ? null : undefined}
                    >
                        <View testID={'assistant-message-controls'} style={localStyles.toolbarSide}>
                            <View ref={setDictationSlot} style={localStyles.controlSlot} />
                            <AssistantVoiceCallButton
                                compact
                                assistant={assistant}
                                projectId={conversationProjectId}
                                skipNavigationOnThreadCreate
                                buttonStyle={localStyles.voiceButton}
                            />
                            <Button
                                icon={'arrow-up'}
                                iconSize={20}
                                onPress={handleSendMessage}
                                disabled={!canSend}
                                buttonStyle={localStyles.sendButton}
                                accessibilityLabel={sendLabel}
                                accessible={true}
                            />
                        </View>
                    </AppPopover>
                </View>
            </View>
        </AttachmentDropZone>
    )
}

const CONTROL = ASSISTANT_TOOLBAR_CONTROL_SIZE

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    headerRow: {
        width: '100%',
        minHeight: ASSISTANT_HEADER_HEIGHT,
        justifyContent: 'center',
        marginBottom: ASSISTANT_HEADER_GAP,
    },
    // The edit pencil (assistant board) sits at the left edge, outside the centred line.
    headerSide: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 1,
    },
    headerCenter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'center',
        maxWidth: '100%',
        minWidth: 0,
        paddingHorizontal: 36,
    },
    avatarWrapper: {
        width: ASSISTANT_HEADER_HEIGHT,
        height: ASSISTANT_HEADER_HEIGHT,
        borderRadius: 8,
        marginRight: 10,
        flexShrink: 0,
    },
    nameText: {
        flexShrink: 1,
        fontSize: 15,
        fontWeight: '600',
        color: colors.Text01,
    },
    greetingText: {
        flexShrink: 2,
        minWidth: 0,
        marginLeft: 8,
        fontSize: 15,
        color: colors.Text03,
    },
    composerBox: {
        width: '100%',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.Grey300,
        backgroundColor: themed.Surface,
        paddingTop: ASSISTANT_COMPOSER_BOX_PADDING_TOP,
        paddingBottom: ASSISTANT_COMPOSER_BOX_PADDING_BOTTOM,
        paddingHorizontal: 6,
    },
    messageInput: {
        width: '100%',
        paddingVertical: ASSISTANT_INPUT_VERTICAL_PADDING / 2,
        paddingHorizontal: 8,
        fontSize: 14,
        lineHeight: 24,
        color: colors.Text01,
        textAlignVertical: 'top',
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: ASSISTANT_TOOLBAR_CONTROL_SIZE,
        marginTop: ASSISTANT_COMPOSER_TOOLBAR_GAP,
    },
    toolbarSide: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    controlSlot: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    toolbarControl: {
        width: CONTROL,
        minWidth: CONTROL,
        height: CONTROL,
        minHeight: CONTROL,
        borderRadius: CONTROL / 2,
        padding: 0,
        paddingHorizontal: 0,
    },
    voiceButton: {
        width: CONTROL,
        height: CONTROL,
        minHeight: CONTROL,
        borderRadius: CONTROL / 2,
        borderWidth: 0,
        paddingHorizontal: 0,
        marginLeft: 0,
        justifyContent: 'center',
    },
    sendButton: {
        width: CONTROL,
        height: CONTROL,
        minHeight: CONTROL,
        borderRadius: CONTROL / 2,
        paddingHorizontal: 0,
        paddingVertical: 0,
        marginLeft: 4,
        alignSelf: 'center',
        justifyContent: 'center',
    },
})
