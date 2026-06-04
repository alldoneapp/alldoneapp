import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { updateAssistantRealtimeVoice } from '../../../../utils/backends/Assistants/assistantsFirestore'
import AssistantRealtimeVoiceModal from '../../../UIComponents/FloatModals/AssistantRealtimeVoiceModal/AssistantRealtimeVoiceModal'

export default function RealtimeVoiceWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)
    const realtimeVoice = assistant.realtimeVoice || 'marin'

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    useEffect(() => {
        isOpenRef.current = isOpen
    }, [isOpen])

    useEffect(() => {
        return () => {
            if (isOpenRef.current) dispatch(hideFloatPopup())
        }
    }, [])

    return (
        <Popover
            content={
                <AssistantRealtimeVoiceModal
                    closeModal={closeModal}
                    realtimeVoice={realtimeVoice}
                    updateRealtimeVoice={voice => updateAssistantRealtimeVoice(projectId, assistant, voice)}
                />
            }
            align="start"
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Button
                type="ghost"
                icon="edit-2"
                onPress={openModal}
                disabled={isOpen || disabled}
                title={realtimeVoice.charAt(0).toUpperCase() + realtimeVoice.slice(1)}
            />
        </Popover>
    )
}
