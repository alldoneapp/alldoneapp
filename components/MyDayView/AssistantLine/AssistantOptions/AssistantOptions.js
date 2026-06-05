import React, { useCallback, useEffect, useState, useRef } from 'react'
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'
import Popover from 'react-tiny-popover'

import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import { stopLoadingData } from '../../../../redux/actions'
import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import { getAssistantLineData, getOptionsPresentationData } from './helper'
import OptionButtons from './OptionButtons/OptionButtons'
import MoreOptionsWrapper from './MoreOptions/MoreOptionsWrapper'
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

const ASSISTANT_INPUT_MIN_HEIGHT = 40
const ASSISTANT_INPUT_MAX_HEIGHT = 120
const ASSISTANT_INPUT_SCROLL_BUFFER = 1

export default function AssistantOptions({
    amountOfButtonOptions,
    onCollapse,
    projectOverride = null,
    assistantIdOverride = null,
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
    const [inputHeight, setInputHeight] = useState(ASSISTANT_INPUT_MIN_HEIGHT)
    const [inputScrollEnabled, setInputScrollEnabled] = useState(false)
    const [mentionsModalActive, setMentionsModalActive] = useState(false)
    const isSendingRef = useRef(false)
    const inputRef = useRef(null)
    const isShiftPressed = useRef(false)

    const assistantId = assistantIdOverride || defaultAssistantId

    const { assistant, assistantProject, assistantProjectId } = getAssistantLineData(
        selectedProject,
        assistantId,
        defaultProjectId
    )

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

    const handleSendMessage = useCallback(async () => {
        const trimmedMessage = message.trim()
        if (!trimmedMessage || isSendingRef.current || !assistant || !assistant.uid) return

        if (gold <= 0) {
            setShowRunOutOfGoldModal(true)
            return
        }

        isSendingRef.current = true
        setIsSending(true)
        try {
            const topicData = await createBotQuickTopic(assistant, trimmedMessage, {
                skipNavigation: true,
                enableAssistant: true,
                projectId: assistantProjectId,
            })

            if (!topicData) {
                isSendingRef.current = false
                setIsSending(false)
                return
            }

            setMessage('')
            setInputHeight(ASSISTANT_INPUT_MIN_HEIGHT)
            setInputScrollEnabled(false)
            inputRef.current?.clear()

            // Unblock the input now that the thread has been created
            isSendingRef.current = false
            setIsSending(false)

            // Continue executing the task in the background without blocking the input
            if (topicData.projectId && !assistantProject?.isTemplate) {
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
    }, [assistant, assistantProject, assistantProjectId, message, gold])

    const updateInputHeight = useCallback(contentHeight => {
        const roundedContentHeight = Math.ceil(contentHeight)
        const nextInputHeight = Math.min(
            Math.max(ASSISTANT_INPUT_MIN_HEIGHT, roundedContentHeight),
            ASSISTANT_INPUT_MAX_HEIGHT
        )

        setInputHeight(nextInputHeight)
        setInputScrollEnabled(roundedContentHeight > ASSISTANT_INPUT_MAX_HEIGHT + ASSISTANT_INPUT_SCROLL_BUFFER)
    }, [])

    const measureInputHeight = useCallback(() => {
        const editorRoot = inputRef.current?.getEditor?.()?.root
        if (editorRoot?.scrollHeight) {
            updateInputHeight(editorRoot.scrollHeight)
        }
    }, [updateInputHeight])

    const requestInputHeightMeasure = useCallback(() => {
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
            window.requestAnimationFrame(measureInputHeight)
        } else {
            setTimeout(measureInputHeight)
        }
    }, [measureInputHeight])

    const updateMessage = useCallback(
        text => {
            setMessage(text)

            if (!text) {
                setInputHeight(ASSISTANT_INPUT_MIN_HEIGHT)
                setInputScrollEnabled(false)
                return
            }

            const lineCount = text.split('\n').length
            updateInputHeight(lineCount * 34 + 6)
            requestInputHeightMeasure()
        },
        [requestInputHeightMeasure, updateInputHeight]
    )

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

    const { optionsLikeButtons, optionsInModal, showSubmenu } = getOptionsPresentationData(
        assistantProject,
        assistant.uid,
        tasks,
        amountOfButtonOptions
    )

    const hasQuickActions = true
    const canSend = message.trim().length > 0 && !isSending

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
                    fixedHeight={inputHeight}
                    maxHeight={ASSISTANT_INPUT_MAX_HEIGHT}
                    onChangeText={updateMessage}
                    onContentSizeChange={(width, height) => updateInputHeight(height)}
                    placeholder={translate('Start a new chat')}
                    projectId={assistantProject.id}
                    styleTheme={TASK_THEME}
                    disabledEdition={isSending}
                    setMentionsModalActive={setMentionsModalActive}
                    keepBreakLines={true}
                    scrollEnabled={inputScrollEnabled}
                    showScrollIndicator={inputScrollEnabled}
                    setEditor={requestInputHeightMeasure}
                />
                <Popover
                    content={<RunOutOfGoldAssistantModal closeModal={() => setShowRunOutOfGoldModal(false)} />}
                    align={'start'}
                    position={['top', 'bottom', 'left', 'right']}
                    onClickOutside={() => setShowRunOutOfGoldModal(false)}
                    isOpen={showRunOutOfGoldModal}
                    contentLocation={isMobile ? null : undefined}
                >
                    <View style={localStyles.sendButtonWrapper}>
                        <AssistantVoiceCallButton
                            compact
                            assistant={assistant}
                            projectId={assistantProjectId}
                            skipNavigationOnThreadCreate
                            buttonStyle={localStyles.voiceButton}
                        />
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
                </Popover>
            </View>
            {hasQuickActions && (
                <View style={localStyles.quickActions}>
                    <AssistantTaskSearchButtonWrapper />
                    <OptionButtons projectId={assistantProject.id} options={optionsLikeButtons} assistant={assistant} />
                    {showSubmenu && (
                        <MoreOptionsWrapper
                            projectId={assistantProject.id}
                            options={optionsInModal}
                            assistant={assistant}
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
    voiceButton: {
        marginLeft: 0,
        marginRight: 8,
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
    quickActions: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'center',
        width: '100%',
    },
})
