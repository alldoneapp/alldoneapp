import React, { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View, TextInput } from 'react-native'
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
                        followerIds: null,
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

    return (
        <View style={localStyles.container}>
            <View style={localStyles.firstRow}>
                <AssistantAvatarButton projectIndex={assistantProject.index} assistant={assistant} />
                <TextInput
                    style={localStyles.messageInput}
                    value={message}
                    onChangeText={setMessage}
                    placeholder={translate('Type a message for the assistant')}
                    placeholderTextColor={colors.Grey500}
                    editable={!isSending}
                    autoCorrect={true}
                    multiline={false}
                    onSubmitEditing={handleSendMessage}
                    returnKeyType={'send'}
                />
                <Button
                    title={translate('Send')}
                    icon={'send'}
                    onPress={handleSendMessage}
                    disabled={!canSend}
                    buttonStyle={localStyles.sendButton}
                    titleStyle={localStyles.sendButtonTitle}
                />
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
        paddingVertical: 8,
        paddingHorizontal: 12,
        fontSize: 14,
        color: colors.Text01,
    },
    sendButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
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
