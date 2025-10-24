import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View, TextInput, Text } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import { stopLoadingData } from '../../../../redux/actions'
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

export default function AssistantOptions({ amountOfButtonOptions }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProject = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const userId = useSelector(state => state.loggedUser.uid)
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const [tasks, setTasks] = useState(null)
    const [message, setMessage] = useState('')
    const [isSending, setIsSending] = useState(false)

    const { assistant, assistantProject, assistantProjectId } = getAssistantLineData(
        selectedProject,
        defaultAssistantId,
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
        if (!trimmedMessage || isSending || !assistant || !assistant.uid) return

        setIsSending(true)
        try {
            const topicData = await createBotQuickTopic(assistant, trimmedMessage)

            if (!topicData) {
                return
            }

            setMessage('')

            if (topicData.projectId && !assistantProject?.isTemplate) {
                try {
                    const userIdsToNotify = generateUserIdsToNotifyForNewComments(
                        topicData.projectId,
                        topicData.isPublicFor,
                        ''
                    )

                    await runHttpsCallableFunction('generateBotAdvaiceSecondGen', {
                        projectId: topicData.projectId,
                        objectId: topicData.chatId,
                        objectType: 'topics',
                        userIdsToNotify,
                        topicName: trimmedMessage,
                        language: window.navigator.language,
                        isPublicFor: topicData.isPublicFor,
                        assistantId: assistant.uid,
                        followerIds: [userId],
                        userId: userId,
                    })
                } catch (error) {
                    console.error('Error triggering assistant reply:', error)
                }
            }
        } catch (error) {
            console.error('Error sending assistant quick message:', error)
        } finally {
            setIsSending(false)
        }
    }, [assistant, assistantProject, isSending, message])

    if (!tasks || !assistant || !assistant.uid) {
        return null
    }

    const { optionsLikeButtons, optionsInModal, showSubmenu } = getOptionsPresentationData(
        assistantProject,
        assistant.uid,
        tasks,
        amountOfButtonOptions
    )

    const hasQuickActions = optionsLikeButtons.length > 0 || showSubmenu
    const canSend = message.trim().length > 0 && !isSending

    const sendLabel = translate('Send')
    const sendButtonTitle = isMobile ? '' : sendLabel
    const sendButtonStyle = isMobile ? localStyles.sendButtonMobile : localStyles.sendButtonDesktop

    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerRow}>
                <Text style={localStyles.headerText} numberOfLines={1}>
                    {`${assistant.displayName}: ${translate('What can I do for you today?')}`}
                </Text>
            </View>
            <View style={localStyles.firstRow}>
                <View style={localStyles.avatarWrapper}>
                    <AssistantAvatarButton projectIndex={assistantProject.index} assistant={assistant} size={48} />
                </View>
                <TextInput
                    style={localStyles.messageInput}
                    value={message}
                    onChangeText={setMessage}
                    placeholder={translate('Type a message for the assistant')}
                    placeholderTextColor={colors.Text03}
                    editable={!isSending}
                    autoCorrect={true}
                    multiline={false}
                    onSubmitEditing={handleSendMessage}
                    returnKeyType={'send'}
                />
                <View style={localStyles.sendButtonWrapper}>
                    <Button
                        title={sendButtonTitle}
                        icon={'send'}
                        onPress={handleSendMessage}
                        disabled={!canSend}
                        buttonStyle={sendButtonStyle}
                        titleStyle={localStyles.sendButtonTitle}
                        accessibilityLabel={sendLabel}
                        accessible={true}
                    />
                </View>
            </View>
            {hasQuickActions && (
                <View style={localStyles.quickActions}>
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
        marginBottom: 16,
    },
    headerText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.Text01,
        textAlign: 'center',
    },
    firstRow: {
        flexDirection: 'row',
        alignItems: 'center',
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
        height: 40,
        minHeight: 40,
        paddingVertical: 8,
        paddingHorizontal: 12,
        fontSize: 14,
        color: colors.Text01,
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
    quickActions: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'center',
        width: '100%',
    },
})
