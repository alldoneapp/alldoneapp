import React, { useState } from 'react'
import AppPopover from '../../../UIComponents/ModalShell/AppPopover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import PreConfigTaskButton from './PreConfigTaskButton'
import PreConfigTaskGeneratorModal from '../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import {
    TASK_TYPE_PROMPT,
    TASK_TYPE_WEBHOOK,
    TASK_TYPE_IFRAME,
} from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { isModalOpen, MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'

export default function PreConfigTaskGeneratorWrapper({
    projectId,
    task,
    assistant,
    children,
    disabled = false,
    skipNavigation = false,
}) {
    const dispatch = useDispatch()
    const gold = useSelector(state => state.loggedUser.gold)
    const isExecuting = useSelector(state => state.preConfigTaskExecuting)
    const [isOpen, setIsOpen] = useState(false)

    const {
        prompt,
        variables,
        name,
        type,
        link,
        aiModel,
        aiReasoningEffort,
        aiSystemMessage,
        taskMetadata,
        sendWhatsApp,
    } = task

    const openModal = () => {
        dismissAllPopups()
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (isModalOpen(MENTION_MODAL_ID)) return
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const addTask = async () => {
        const aiSettings = {
            model: aiModel,
            reasoningEffort: aiReasoningEffort,
            systemMessage: aiSystemMessage,
        }
        console.log('PreConfigTaskGeneratorWrapper generating task:', {
            taskName: name,
            aiSettings,
            taskMetadata,
            sendWhatsApp,
            sendWhatsAppType: typeof sendWhatsApp,
            sendWhatsAppRawValue: sendWhatsApp,
        })
        const mergedTaskMetadata = {
            ...(taskMetadata || {}),
            sendWhatsApp: !!sendWhatsApp,
            executionMode: task.executionMode,
        }
        console.log('PreConfigTaskGeneratorWrapper merged taskMetadata:', {
            mergedTaskMetadata,
            originalSendWhatsApp: sendWhatsApp,
            convertedSendWhatsApp: !!sendWhatsApp,
        })
        generateTaskFromPreConfig(projectId, name, assistant.uid, prompt, aiSettings, mergedTaskMetadata, {
            skipNavigation,
        })
    }

    const running = isExecuting === name
    const executionDisabled = disabled || running

    const pressButton = event => {
        event?.stopPropagation?.()

        // Prevent execution if this task is already running
        if (executionDisabled) {
            return
        }

        if (gold <= 0) {
            openModal()
        } else {
            if (type === TASK_TYPE_PROMPT || type === TASK_TYPE_WEBHOOK) {
                if ((variables || []).length > 0) {
                    openModal()
                } else {
                    addTask()
                }
            } else if (type === TASK_TYPE_IFRAME) {
                dispatch({
                    type: 'Set iframe modal data',
                    visible: true,
                    url: link,
                    name: name,
                })
            } else {
                window.open(link, '_blank')
            }
        }
    }

    return (
        <AppPopover
            key={!isOpen}
            content={
                gold > 0 ? (
                    <PreConfigTaskGeneratorModal
                        projectId={projectId}
                        closeModal={closeModal}
                        task={task}
                        assistant={assistant}
                    />
                ) : (
                    <RunOutOfGoldAssistantModal closeModal={closeModal} />
                )
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={null}
        >
            {typeof children === 'function' ? (
                children({ onPress: pressButton, running, disabled: executionDisabled })
            ) : (
                <PreConfigTaskButton
                    projectId={projectId}
                    task={task}
                    onPress={pressButton}
                    disabled={executionDisabled}
                />
            )}
        </AppPopover>
    )
}
