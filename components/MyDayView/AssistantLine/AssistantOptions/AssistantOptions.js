import React, { useCallback, useEffect, useState, useRef } from 'react'
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
import { createBotQuickTopic, generateUserIdsToNotifyForNewComments } from '../../../../utils/assistantHelper'
import Button from '../../../UIControls/Button'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { runHttpsCallableFunction } from '../../../../utils/backends/firestore'
import Spinner from '../../../UIComponents/Spinner'
import Icon from '../../../Icon'
import CustomTextInput3 from '../../../Feeds/CommentsTextInput/CustomTextInput3'
import { TASK_THEME } from '../../../Feeds/CommentsTextInput/textInputHelper'
import AssistantTaskSearchButtonWrapper from './Search/AssistantTaskSearchButtonWrapper'
import AssistantVoiceCallButton from '../../../UIComponents/AssistantVoiceCallButton'
import {
    ASSISTANT_INPUT_MAX_HEIGHT,
    getAssistantControlsStacked,
    getAssistantInputDisplayHeight,
    getAssistantInputLayout,
    INITIAL_ASSISTANT_INPUT_LAYOUT,
} from '../assistantInputLayout'

export default function AssistantOptions({
    amountOfButtonOptions,
    onCollapse,
    projectOverride = null,
    assistantIdOverride = null,
    showAllQuickActions = false,
    preferAssistantIdOverride = false,
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
    const [tasks, setTasks] = useState(null)
    const [message, setMessage] = useState('')
    const [isSending, setIsSending] = useState(false)
    const [showRunOutOfGoldModal, setShowRunOutOfGoldModal] = useState(false)
    const [inputLayout, setInputLayout] = useState(INITIAL_ASSISTANT_INPUT_LAYOUT)
    const [controlsStacked, setControlsStacked] = useState(false)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const [quickActionsExpanded, setQuickActionsExpanded] = useState(showAllQuickActions)
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

    useEffect(() => {
        if (assistantProjectId && assistant && assistant.uid) {
            const watcherKey = v4()
            watchAssistantTasks(
                isGlobalAssistant(assistant.uid) ? GLOBAL_PROJECT_ID : assistantProjectId,
                assistant.uid,
                watcherKey,
                setTasks
            )
            return () => {
                unwatch(watcherKey)
                dispatch(stopLoadingData())
            }
        } else {
            setTasks(null)
        }
    }, [assistant?.uid, assistantProjectId])

    useEffect(() => {
        setQuickActionsExpanded(showAllQuickActions)
    }, [assistant?.uid, assistantProjectId, showAllQuickActions])

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

            inputRef.current?.blur()
            Keyboard.dismiss()
            isSendingRef.current = true
            setIsSending(true)
            try {
                const topicData = await createBotQuickTopic(assistant, trimmedMessage, {
                    skipNavigation: true,
                    enableAssistant: true,
                    projectId: conversationProjectId,
                })

                if (!topicData) {
                    isSendingRef.current = false
                    setIsSending(false)
                    return
                }

                setMessage('')
                setInputLayout(INITIAL_ASSISTANT_INPUT_LAYOUT)
                inputRef.current?.clear()

                // Unblock the input now that the thread has been created
                isSendingRef.current = false
                setIsSending(false)

                // Continue executing the task in the background without blocking the input
                if (topicData.projectId && !conversationProject?.isTemplate) {
                    try {
                        const userIdsToNotify = generateUserIdsToNotifyForNewComments(
                            topicData.projectId,
                            topicData.isPublicFor,
                            ''
                        )
                    } catch (error) {
                        console.error('❌ [AssistantOptions] Error triggering assistant reply:', error)
                    }
                }
            } catch (error) {
                console.error('❌ [AssistantOptions] Error sending assistant quick message:', error)
                isSendingRef.current = false
                setIsSending(false)
            }
        },
        [assistant, conversationProject, conversationProjectId, message, gold]
    )

    const updateInputHeight = useCallback(contentHeight => {
        setInputLayout(previousLayout => getAssistantInputLayout(contentHeight, previousLayout))
    }, [])

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

    if (!tasks || !assistant || !assistant.uid || !assistantProject) {
        return null
    }

    const { optionsLikeButtons, hasAdditionalOptions } = getOptionsPresentationData(
        conversationProject,
        assistant.uid,
        tasks,
        amountOfButtonOptions,
        quickActionsExpanded
    )

    const hasQuickActions = true
    const canSend = message.trim().length > 0 && !isSending
    const inputDisplayHeight = getAssistantInputDisplayHeight(inputLayout.height, controlsStacked)

    const sendLabel = translate('Send')
    const sendButtonTitle = isMobile ? '' : sendLabel
    const sendButtonStyle = isMobile ? localStyles.sendButtonMobile : localStyles.sendButtonDesktop
    const HeaderContainer = onCollapse ? TouchableOpacity : View
    const headerContainerProps = onCollapse ? { onPress: onCollapse, activeOpacity: 0.8 } : {}

    return (
        <View style={localStyles.container}>
            <HeaderContainer style={localStyles.headerRow} {...headerContainerProps}>
                <Text style={localStyles.headerText} numberOfLines={1}>
                    {`${assistant.displayName}: ${translate('What can I do for you today?')}`}
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
                    maxHeight={ASSISTANT_INPUT_MAX_HEIGHT}
                    onChangeText={updateMessage}
                    onContentSizeChange={(width, height) => updateInputHeight(height)}
                    placeholder={translate('Start a new chat')}
                    projectId={conversationProjectId}
                    styleTheme={TASK_THEME}
                    disabledEdition={isSending}
                    setMentionsModalActive={setMentionsModalActive}
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
                </AppPopover>
            </View>
            {hasQuickActions && (
                <View style={localStyles.quickActions}>
                    <AssistantTaskSearchButtonWrapper />
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
                </View>
            )}
        </View>
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
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'center',
        width: '100%',
    },
})
