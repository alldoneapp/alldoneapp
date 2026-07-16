import React, { useEffect, useRef, useState } from 'react'
import { TouchableOpacity, StyleSheet, Text, View } from 'react-native-web'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import {
    setAssistantEnabled,
    setSelectedNavItem,
    setShowNotificationAboutTheBotBehavior,
    setTriggerChatSubmit,
    setTriggerChatDraft,
} from '../../redux/actions'
import { colors } from '../styles/global'
import {
    getAssistantInProjectObject,
    resolveAssistantForProjectObject,
} from '../AdminPanel/Assistants/assistantsHelper'
import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import BotOptionsModal from '../ChatsView/ChatDV/EditorView/BotOption/BotOptionsModal'
import RunOutOfGoldAssistantModal from '../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import { isModalOpen, MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { setObjectAssistantEnabled } from '../../utils/assistantHelper'
import { setTaskAssistant } from '../../utils/backends/Tasks/tasksFirestore'

export default function DvBotButton({
    style,
    navItem,
    projectId,
    assistantId,
    setAssistantId,
    objectId,
    objectType,
    parentObject,
    updateObjectState,
    onOpenSideChat,
    showAssistantName = false,
    resolveProjectAssistant = false,
}) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const mainChatEditor = useSelector(state => state.mainChatEditor)
    const noticeAboutTheBotBehavior = useSelector(state => state.loggedUser.noticeAboutTheBotBehavior)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const [isOpen, setIsOpen] = useState(false)
    const [optimisticAssistantId, setOptimisticAssistantId] = useState(assistantId)
    const latestAssistantIdRef = useRef(assistantId)

    useEffect(() => {
        setOptimisticAssistantId(assistantId)
        latestAssistantIdRef.current = assistantId
    }, [assistantId])

    const requestedAssistantId = optimisticAssistantId || assistantId
    const assistant = resolveProjectAssistant
        ? resolveAssistantForProjectObject(projectId, requestedAssistantId)
        : getAssistantInProjectObject(projectId, requestedAssistantId)
    const effectiveAssistantId = assistant?.uid || requestedAssistantId
    const { photoURL50, displayName } = assistant || {}

    const updateAssistantId = newAssistantId => {
        latestAssistantIdRef.current = newAssistantId
        setOptimisticAssistantId(newAssistantId)
        setAssistantId?.(newAssistantId)
    }

    const navigateToChat = () => {
        dispatch(setSelectedNavItem(navItem))
    }

    const onSelectBotOption = async (optionText, name, aiSettings, options) => {
        const selectedAssistantId = resolveProjectAssistant
            ? resolveAssistantForProjectObject(projectId, latestAssistantIdRef.current)?.uid || effectiveAssistantId
            : latestAssistantIdRef.current || effectiveAssistantId

        if (
            resolveProjectAssistant &&
            (objectType === 'task' || objectType === 'tasks') &&
            parentObject?.assistantId !== selectedAssistantId
        ) {
            try {
                await setTaskAssistant(projectId, objectId, selectedAssistantId, !!parentObject?.assistantId)
            } catch (error) {
                console.error('Error assigning resolved assistant to task:', error)
            }
        }
        await setObjectAssistantEnabled(projectId, objectId, objectType, true)
        if (parentObject && updateObjectState) {
            updateObjectState({
                ...parentObject,
                assistantId: selectedAssistantId,
                isAssistantEnabled: true,
            })
        }

        // Prefer running the assistant in the note side chat when it is available,
        // so we stay on the note instead of switching to the full-screen chat tab.
        const openedInSideChat = onOpenSideChat?.() === true
        if (!openedInSideChat) navigateToChat()
        setTimeout(() => {
            dispatch(setAssistantEnabled(true))
            if (optionText) {
                if (options?.pasteOnly) {
                    dispatch(setTriggerChatDraft({ text: optionText }))
                } else {
                    dispatch(setTriggerChatSubmit({ text: optionText }))
                }
            } else {
                if (mainChatEditor) {
                    mainChatEditor.getSelection(true)
                }
            }
        }, 500)
    }

    const openModal = () => {
        if (resolveProjectAssistant && !assistant) return
        if (!noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))
        if (gold <= 0) dispatch(setAssistantEnabled(false))
        setIsOpen(true)
        if (document.activeElement) document.activeElement.blur()
    }

    const closeModal = () => {
        if (isModalOpen(MENTION_MODAL_ID)) return
        setIsOpen(false)
    }

    return (
        <Popover
            content={
                resolveProjectAssistant && !assistant ? null : gold > 0 ? (
                    <BotOptionsModal
                        closeModal={closeModal}
                        onSelectBotOption={onSelectBotOption}
                        assistantId={effectiveAssistantId}
                        setAssistantId={updateAssistantId}
                        parentObject={parentObject}
                        projectId={projectId}
                        objectId={objectId}
                        objectType={objectType}
                        inChatTab={false}
                        updateObjectState={updateObjectState}
                    />
                ) : (
                    <RunOutOfGoldAssistantModal closeModal={closeModal} />
                )
            }
            align={'end'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen && noticeAboutTheBotBehavior && !showNotificationAboutTheBotBehavior}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <TouchableOpacity
                style={[
                    localStyles.container,
                    showAssistantName && localStyles.namedContainer,
                    showAssistantName && smallScreenNavigation && localStyles.namedContainerMobile,
                    style,
                ]}
                onPress={openModal}
                disabled={resolveProjectAssistant && !assistant}
                accessibilityLabel={
                    showAssistantName
                        ? displayName
                            ? `Open ${displayName} predefined tasks`
                            : 'No assistant available'
                        : undefined
                }
            >
                <AssistantAvatar photoURL={photoURL50} assistantId={effectiveAssistantId} size={24} />
                {showAssistantName && (
                    <Text style={localStyles.assistantName} numberOfLines={1}>
                        {displayName || 'No assistant'}
                    </Text>
                )}
            </TouchableOpacity>
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        maxHeight: 32,
        minHeight: 32,
        borderWidth: 1,
        borderRadius: 4,
        flexDirection: 'row',
        backgroundColor: 'transparent',
        borderColor: colors.Gray400,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        paddingHorizontal: 7,
        marginRight: 8,
    },
    namedContainer: {
        maxWidth: 180,
        paddingVertical: 3,
        paddingHorizontal: 7,
    },
    namedContainerMobile: {
        maxWidth: 132,
    },
    assistantName: {
        color: colors.Text03,
        flexShrink: 1,
        fontSize: 14,
        lineHeight: 20,
        marginLeft: 6,
        minWidth: 0,
        overflow: 'hidden',
    },
})
