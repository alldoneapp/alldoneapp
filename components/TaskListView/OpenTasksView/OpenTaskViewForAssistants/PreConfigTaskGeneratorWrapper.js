import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import PreConfigTaskButton from './PreConfigTaskButton'
import PreConfigTaskGeneratorModal from '../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal'
import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import { generateTaskFromPreConfig } from '../../../../utils/assistantHelper'
import RunOutOfGoldAssistantModal from '../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import { TASK_TYPE_PROMPT, TASK_TYPE_WEBHOOK } from '../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'
import { isModalOpen, MENTION_MODAL_ID } from '../../../ModalsManager/modalsManager'

export default function PreConfigTaskGeneratorWrapper({ projectId, task, assistant }) {
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
        aiTemperature,
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
            temperature: aiTemperature,
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
        const mergedTaskMetadata = { ...(taskMetadata || {}), sendWhatsApp: !!sendWhatsApp }
        console.log('PreConfigTaskGeneratorWrapper merged taskMetadata:', {
            mergedTaskMetadata,
            originalSendWhatsApp: sendWhatsApp,
            convertedSendWhatsApp: !!sendWhatsApp,
        })
        generateTaskFromPreConfig(projectId, name, assistant.uid, prompt, aiSettings, mergedTaskMetadata)
    }

    const pressButton = () => {
        // Prevent execution if this task is already running
        if (isExecuting === name) {
            return
        }

        if (gold <= 0) {
            openModal()
        } else {
            if (type === TASK_TYPE_PROMPT || type === TASK_TYPE_WEBHOOK) {
                variables.length > 0 ? openModal() : addTask()
            } else {
                window.open(link, '_blank')
            }
        }
    }

    return (
        <Popover
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
            <PreConfigTaskButton
                projectId={projectId}
                task={task}
                onPress={pressButton}
                disabled={isExecuting === name}
            />
        </Popover>
    )
}
