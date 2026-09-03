import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Keyboard, StyleSheet, View, Text, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'

import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import { stopLoadingData } from '../../../../redux/actions'
import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import { getAssistantLineData, getOptionsPresentationData } from './helper'
import OptionButtons from './OptionButtons/OptionButtons'
import QuickActionsToggle from './QuickActionsToggle'
import AssistantAvatarButton from './AssistantAvatarButton'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../../../utils/backends/firestore'
import Icon from '../../../Icon'
// The canonical, dependency-free definition of the key — deliberately not the re-export from
// `chatsComments`, which would drag the whole comments backend into this composer.
import { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } from '../../../../utils/backends/Chats/chatNotificationPriority'
import {
    beginAssistantLineSend,
    failAssistantLineSend,
    markAssistantLineSendCreated,
} from '../assistantLinePendingSend'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import AttachmentDropZone from '../../../Feeds/CommentsTextInput/AttachmentDropZone'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import AssistantTaskSearchButtonWrapper from './Search/AssistantTaskSearchButtonWrapper'
import AssistantVoiceCallButton from '../../../UIComponents/AssistantVoiceCallButton'
import {
    getAssistantControlsStacked,
    getAssistantInputDisplayHeight,
    getAssistantInputLayout,
    INITIAL_ASSISTANT_INPUT_LAYOUT,
} from '../assistantInputLayout'
import { assistantComposerHasMedia, getAssistantComposerMaxHeight } from '../assistantComposerMedia'
import {
    ASSISTANT_QUICK_ACTIONS_DESKTOP_HEIGHT,
    ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT,
    AssistantOptionButtonsSkeleton,
} from '../AssistantLineSkeleton'
import { readAssistantTasksCache, writeAssistantTasksCache } from '../assistantLineCache'

// The formats an attachment-capable input must declare. `CustomTextInput3.supportsAttachments`
// keys on `attachment` / `customImageFormat` being present, and that predicate is what installs
// `quill.appManagedFileUpload` — so without this list a drop is inserted by Quill's own uploader
// as an unserializable base64 embed that vanishes on submit (AT-2441), and a paste does the same.
const ASSISTANT_INPUT_ATTACHMENT_FORMATS = ['image', 'attachment', 'customImageFormat', 'videoFormat']
export const DEFERRED_QUICK_ACTION_REFRESH_MS = 1000

export default function AssistantOptions({
    amountOfButtonOptions,
    onCollapse,
    projectOverride = null,
    assistantIdOverride = null,
    showAllQuickActions = false,
    preferAssistantIdOverride = false,
    deferQuickActions = false,
}) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProjectFromStore = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const selectedProject = projectOverride || selectedProjectFromStore
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const userId = useSelector(state => state.loggedUser.uid)
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const gold = useSelector(state => state.loggedUser.gold)
    const [message, setMessage] = useState('')
    const [showRunOutOfGoldModal, setShowRunOutOfGoldModal] = useState(false)
    const [inputLayout, setInputLayout] = useState(INITIAL_ASSISTANT_INPUT_LAYOUT)
    const [controlsStacked, setControlsStacked] = useState(false)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const [quickActionsExpanded, setQuickActionsExpanded] = useState(showAllQuickActions)
    // AT-2444: the live Quill instance and caret the drop zone inserts at. The zone stays disabled
    // until `setEditor` has handed the editor over, so an early drop can never be half-applied.
    const [editor, setEditor] = useState(null)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
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
    const assistantTasksProjectId = assistant?.uid
        ? isGlobalAssistant(assistant.uid)
            ? GLOBAL_PROJECT_ID
            : assistantProjectId
        : null
    const cachedTasks = useMemo(
        () =>
            readAssistantTasksCache({
                userId,
                projectId: assistantTasksProjectId,
                assistantId: assistant?.uid,
            }),
        [assistant?.uid, assistantTasksProjectId, userId]
    )
    const [tasks, setTasks] = useState(cachedTasks)
    // The assistant can live in another project, but conversations started from
    // this line must inherit the project the user currently has selected.
    const conversationProject = selectedProjectFromStore || selectedProject || assistantProject
    const conversationProjectId = conversationProject?.id || assistantProjectId

    useEffect(() => {
        setTasks(cachedTasks)

        if (!assistantTasksProjectId || !assistant?.uid) return undefined

        const watcherKey = v4()
        let watcherStarted = false
        let refreshTimer = null
        const startWatcher = () => {
            watcherStarted = true
            watchAssistantTasks(assistantTasksProjectId, assistant.uid, watcherKey, liveTasks => {
                setTasks(liveTasks)
                writeAssistantTasksCache(
                    {
                        userId,
                        projectId: assistantTasksProjectId,
                        assistantId: assistant.uid,
                    },
                    liveTasks
                )
            })
        }

        if (deferQuickActions) {
            refreshTimer = setTimeout(startWatcher, DEFERRED_QUICK_ACTION_REFRESH_MS)
        } else {
            startWatcher()
        }

        return () => {
            if (refreshTimer) clearTimeout(refreshTimer)
            if (watcherStarted) {
                unwatch(watcherKey)
                dispatch(stopLoadingData())
            }
        }
    }, [assistant?.uid, assistantTasksProjectId, cachedTasks, deferQuickActions, userId])

    useEffect(() => {
        setQuickActionsExpanded(showAllQuickActions)
    }, [assistant?.uid, assistantProjectId, showAllQuickActions])

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
                markAssistantLineSendCreated(pendingSendId, topicData.chatId)
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

    // Stack the voice + send buttons into a column as soon as the field grows
    // past one line, and release that only when the field is emptied again. See
    // getAssistantControlsStacked for why the release must not depend on the
    // measured height.
    useEffect(() => {
        setControlsStacked(wasStacked =>
            getAssistantControlsStacked({
                inputHeight: inputLayout.height,
                hasText: message.length > 0,
                wasStacked,
            })
        )
    }, [inputLayout.height, message])

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

    const tasksLoaded = Array.isArray(tasks)
    const { optionsLikeButtons, hasAdditionalOptions } = tasksLoaded
        ? getOptionsPresentationData(
              conversationProject,
              assistant.uid,
              tasks,
              amountOfButtonOptions,
              quickActionsExpanded
          )
        : { optionsLikeButtons: [], hasAdditionalOptions: false }

    const hasQuickActions = true
    // An image on its own is a complete message — the serialized embed token IS the text, so this
    // is already non-empty for an attachment-only composer and needs no separate condition.
    //
    // AT-2504: there is no `&& !isSending` term any more. The composer empties synchronously on
    // submit, so an in-flight send already leaves this false through `message`, and a SECOND
    // message typed while the first is still being created is deliberately allowed — it gets its
    // own topic, which is what two sends have always produced.
    const canSend = message.trim().length > 0
    const inputDisplayHeight = getAssistantInputDisplayHeight(inputLayout.height, controlsStacked, composerMaxHeight)

    const sendLabel = translate('Send')
    const sendButtonTitle = isMobile ? '' : sendLabel
    const sendButtonStyle = isMobile ? localStyles.sendButtonMobile : localStyles.sendButtonDesktop
    const HeaderContainer = onCollapse ? TouchableOpacity : View
    const headerContainerProps = onCollapse ? { onPress: onCollapse, activeOpacity: 0.8 } : {}

    return (
        // AT-2444 — the whole assistant card is the drop target, not just the field. The composer
        // is a 40px line inside a ~128px card, so an input-only target is easy to miss; dropping
        // onto the avatar, the send button or the quick-action row all mean the same thing.
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
            <HeaderContainer style={localStyles.headerRow} {...headerContainerProps}>
                {/* Kept short on purpose (AT-2442): the header is a single centred line
                    (numberOfLines={1}) that also carries the assistant's display name, so a
                    longer greeting ellipsises on narrow phones. */}
                <Text style={localStyles.headerText} numberOfLines={1}>
                    {`${assistant.displayName}: ${translate('How can I help?')}`}
                </Text>
                {!!onCollapse && (
                    <View style={localStyles.collapseButton}>
                        <Icon name={'chevron-up'} size={16} color={colors.Text03} />
                    </View>
                )}
            </HeaderContainer>
            <View style={localStyles.firstRow}>
                <View style={localStyles.avatarWrapper}>
                    <AssistantAvatarButton projectIndex={assistantProject.index} assistant={assistant} size={48} />
                </View>
                <CustomTextInput3
                    ref={inputRef}
                    containerStyle={localStyles.messageInput}
                    fixedHeight={inputDisplayHeight}
                    maxHeight={composerMaxHeight}
                    onChangeText={updateMessage}
                    onContentSizeChange={(width, height) => updateInputHeight(height)}
                    placeholder={translate('Start a new chat')}
                    projectId={conversationProjectId}
                    styleTheme={TASK_THEME}
                    setMentionsModalActive={setMentionsModalActive}
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
                    // instead of waiting for hover/focus — on touch there is no hover at all, so
                    // it used to appear only after the field was already tapped (AT-2355).
                    alwaysShowDictation={true}
                    // Push-to-talk (AT-2405): hold the mic, speak, release — the transcript is
                    // inserted and the message is sent. Enter's own guards still apply, since this
                    // is the same send path the keydown listener uses.
                    onDictationSubmit={text => text && handleSendMessage(text)}
                />
                <AppPopover
                    content={<RunOutOfGoldAssistantModal closeModal={() => setShowRunOutOfGoldModal(false)} />}
                    align={'start'}
                    position={['top', 'bottom', 'left', 'right']}
                    onClickOutside={() => setShowRunOutOfGoldModal(false)}
                    isOpen={showRunOutOfGoldModal}
                    contentLocation={isMobile ? null : undefined}
                >
                    <View
                        testID={'assistant-message-controls'}
                        style={[
                            localStyles.sendButtonWrapper,
                            controlsStacked && localStyles.sendButtonWrapperExpanded,
                        ]}
                    >
                        <AssistantVoiceCallButton
                            compact
                            assistant={assistant}
                            projectId={conversationProjectId}
                            skipNavigationOnThreadCreate
                            buttonStyle={[localStyles.voiceButton, controlsStacked && localStyles.voiceButtonExpanded]}
                        />
                        <Button
                            title={sendButtonTitle}
                            icon={'send'}
                            onPress={handleSendMessage}
                            disabled={!canSend}
                            buttonStyle={[sendButtonStyle, controlsStacked && localStyles.sendButtonStacked]}
                            titleStyle={localStyles.sendButtonTitle}
                            accessibilityLabel={sendLabel}
                            accessible={true}
                        />
                    </View>
                </AppPopover>
            </View>
            {hasQuickActions && (
                <View style={[localStyles.quickActions, isMobile && localStyles.quickActionsMobile]}>
                    <AssistantTaskSearchButtonWrapper />
                    {tasksLoaded ? (
                        <>
                            <OptionButtons
                                projectId={conversationProjectId}
                                options={optionsLikeButtons}
                                assistant={assistant}
                            />
                            {hasAdditionalOptions && (
                                <QuickActionsToggle
                                    expanded={quickActionsExpanded}
                                    onPress={() => setQuickActionsExpanded(expanded => !expanded)}
                                />
                            )}
                        </>
                    ) : (
                        <AssistantOptionButtonsSkeleton />
                    )}
                </View>
            )}
        </AttachmentDropZone>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    headerRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    headerText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        color: colors.Text01,
        textAlign: 'center',
        marginLeft: 22,
    },
    collapseButton: {
        marginLeft: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    firstRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        width: '100%',
        marginBottom: 12,
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
        paddingVertical: 3,
        paddingHorizontal: 12,
        fontSize: 14,
        lineHeight: 22,
        color: colors.Text01,
        textAlignVertical: 'top',
    },
    avatarWrapper: {
        width: 56,
        height: 56,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    sendButtonWrapper: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendButtonWrapperExpanded: {
        flexDirection: 'column',
        // The cluster shrinks to the widest control (the send button), so the
        // send button keeps its collapsed position at the right edge of the row
        // and the voice button sits centred directly above it. The ~48px the
        // row layout needed for the second button is handed back to the flex:1
        // input, which is what "the input field should expand accordingly" means.
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
    sendButtonStacked: {
        // Button's own buttonMaster sets alignSelf: 'flex-start', which would
        // win over the wrapper's alignItems and pull the send button off the
        // shared centre axis. Re-assert it here.
        alignSelf: 'center',
    },
    sendButtonTitle: {
        fontSize: 14,
    },
    quickActions: {
        minHeight: ASSISTANT_QUICK_ACTIONS_DESKTOP_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'center',
        width: '100%',
    },
    quickActionsMobile: {
        minHeight: ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT,
    },
})
