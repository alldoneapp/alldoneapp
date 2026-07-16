import React, { useEffect, useRef, useState } from 'react'
import { TouchableOpacity, StyleSheet, View } from 'react-native-web'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

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
import { executePreConfigPromptForTask, setObjectAssistantEnabled } from '../../utils/assistantHelper'
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
    resolveProjectAssistant = false,
    disabled = false,
    stopPressPropagation = false,
    hotkey,
}) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const mainChatEditor = useSelector(state => state.mainChatEditor)
    const noticeAboutTheBotBehavior = useSelector(state => state.loggedUser.noticeAboutTheBotBehavior)
    const showNotificationAboutTheBotBehavior = useSelector(state => state.showNotificationAboutTheBotBehavior)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    // Assistant data is loaded independently from the task. Subscribe to every store slice used
    // by the imperative resolver so this control replaces its fallback as soon as assistants or
    // project defaults arrive, even when none of its ordinary props changed.
    useSelector(
        state =>
            resolveProjectAssistant
                ? {
                      projectAssistants: state.projectAssistants,
                      globalAssistants: state.globalAssistants,
                      defaultAssistant: state.defaultAssistant,
                      loggedUserProjects: state.loggedUserProjects,
                      loggedUserProjectsMap: state.loggedUserProjectsMap,
                  }
                : null,
        shallowEqual
    )

    const [isOpen, setIsOpen] = useState(false)
    const [optimisticAssistantId, setOptimisticAssistantId] = useState(assistantId)
    const latestAssistantIdRef = useRef(assistantId)
    const promptExecutionRef = useRef(false)

    useEffect(() => {
        setOptimisticAssistantId(assistantId)
        latestAssistantIdRef.current = assistantId
    }, [assistantId])

    const requestedAssistantId = optimisticAssistantId || assistantId
    const assistant = resolveProjectAssistant
        ? resolveAssistantForProjectObject(projectId, requestedAssistantId)
        : getAssistantInProjectObject(projectId, requestedAssistantId)
    const effectiveAssistantId = assistant?.uid || requestedAssistantId
    const { displayName } = assistant || {}
    const assistantPhotoURL = assistant?.photoURL50 || assistant?.photoURL || assistant?.photoURL300

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

        const shouldExecutePromptInBackground =
            resolveProjectAssistant &&
            (objectType === 'task' || objectType === 'tasks') &&
            !!optionText &&
            !options?.pasteOnly

        if (shouldExecutePromptInBackground) {
            closeModal()
            if (promptExecutionRef.current) return

            promptExecutionRef.current = true
            if (parentObject && updateObjectState) {
                updateObjectState({
                    ...parentObject,
                    assistantId: selectedAssistantId,
                    isAssistantEnabled: true,
                })
            }

            Promise.resolve(
                executePreConfigPromptForTask({
                    projectId,
                    taskId: objectId,
                    task: parentObject,
                    assistantId: selectedAssistantId,
                    prompt: optionText,
                    name,
                    aiSettings,
                    taskMetadata: options?.taskMetadata,
                })
            )
                .catch(error => {
                    console.error('Failed to start pre-config prompt in background:', error)
                })
                .finally(() => {
                    promptExecutionRef.current = false
                })
            return
        }

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

    const openModal = event => {
        if (stopPressPropagation) {
            event?.preventDefault?.()
            event?.stopPropagation?.()
        }
        if (disabled || (resolveProjectAssistant && !assistant)) return
        if (!noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))
        if (gold <= 0) dispatch(setAssistantEnabled(false))
        setIsOpen(true)
        if (document.activeElement) document.activeElement.blur()
    }

    const closeModal = () => {
        if (isModalOpen(MENTION_MODAL_ID)) return
        setIsOpen(false)
    }

    const assistantButton = (
        <TouchableOpacity
            style={[localStyles.container, style]}
            onPress={openModal}
            disabled={disabled || (resolveProjectAssistant && !assistant)}
            accessibilityLabel={
                resolveProjectAssistant
                    ? displayName
                        ? `Open ${displayName} predefined tasks`
                        : 'No assistant available'
                    : undefined
            }
        >
            <AssistantAvatar photoURL={assistantPhotoURL} assistantId={effectiveAssistantId} size={24} />
        </TouchableOpacity>
    )

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
            {hotkey ? (
                <Hotkeys keyName={hotkey} onKeyDown={openModal} filter={() => true}>
                    {assistantButton}
                </Hotkeys>
            ) : (
                assistantButton
            )}
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
})
