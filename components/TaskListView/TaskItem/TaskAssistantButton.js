import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import Popover from 'react-tiny-popover'
import { useDispatch } from 'react-redux'

import Icon from '../../Icon'
import { colors } from '../../styles/global'
import AssistantModal from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantModal'
import { TASK_ASSISTANT_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import {
    hideFloatPopup,
    setAssistantEnabled,
    setSelectedNavItem,
    setTriggerChatDraft,
    showFloatPopup,
} from '../../../redux/actions'
import { setTaskAssistant } from '../../../utils/backends/Tasks/tasksFirestore'
import { setObjectAssistantEnabled } from '../../../utils/assistantHelper'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_TASK_CHAT } from '../../../utils/TabNavigationConstants'

const TASK_START_PROMPT = 'Start working on this task. Feel free to ask questions is anything is unclear'

export default function TaskAssistantButton({ projectId, task, disabled, dismissEditMode }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)

    const closeModal = () => {
        removeModal(TASK_ASSISTANT_MODAL_ID)
        if (isOpenRef.current) {
            isOpenRef.current = false
            dispatch(hideFloatPopup())
        }
        setIsOpen(false)
    }

    const openModal = e => {
        e?.preventDefault?.()
        e?.stopPropagation?.()
        if (isOpenRef.current) return
        storeModal(TASK_ASSISTANT_MODAL_ID)
        dispatch(showFloatPopup())
        isOpenRef.current = true
        setIsOpen(true)
    }

    const selectAssistant = async assistantId => {
        const updatedTask = { ...task, assistantId, isAssistantEnabled: true }
        closeModal()
        dismissEditMode?.()

        try {
            await Promise.all([
                task.assistantId !== assistantId
                    ? setTaskAssistant(projectId, task.id, assistantId, !!task.assistantId)
                    : Promise.resolve(),
                setObjectAssistantEnabled(projectId, task.id, 'tasks', true),
            ])
        } catch (error) {
            console.error('Error activating assistant for task:', error)
        }

        NavigationService.navigate('TaskDetailedView', {
            task: updatedTask,
            projectId,
            assistantId,
        })
        dispatch([
            setSelectedNavItem(DV_TAB_TASK_CHAT),
            setAssistantEnabled(true),
            setTriggerChatDraft({ text: TASK_START_PROMPT, chatId: task.id }),
        ])
    }

    useEffect(() => {
        return () => {
            removeModal(TASK_ASSISTANT_MODAL_ID)
            if (isOpenRef.current) dispatch(hideFloatPopup())
        }
    }, [])

    return (
        <View style={localStyles.container}>
            <Popover
                content={
                    <AssistantModal
                        closeModal={closeModal}
                        projectId={projectId}
                        updateAssistant={selectAssistant}
                        currentAssistantId={task.assistantId}
                        includeDefaultProjectAssistant={false}
                        alwaysUpdateOnSelect={true}
                    />
                }
                isOpen={isOpen}
                onClickOutside={closeModal}
                position={['bottom', 'right', 'top', 'left']}
                padding={4}
            >
                <Hotkeys keyName={'alt+a'} onKeyDown={openModal} filter={e => true}>
                    <TouchableOpacity
                        style={localStyles.button}
                        activeOpacity={0.7}
                        onPress={openModal}
                        disabled={disabled}
                        accessibilityLabel="Select an assistant for this task"
                    >
                        <Icon name="cpu" size={20} color={disabled ? colors.Text03 : colors.Primary100} />
                    </TouchableOpacity>
                </Hotkeys>
            </Popover>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        zIndex: 10,
    },
    button: {
        width: 24,
        height: 24,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Primary050,
    },
})
