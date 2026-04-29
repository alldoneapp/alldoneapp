import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import AssistantPromptHistoryModal from '../../../UIComponents/FloatModals/AssistantPromptHistoryModal/AssistantPromptHistoryModal'

export default function PromptHistoryWrapper({
    disabled,
    projectId,
    assistant,
    promptField,
    historyField,
    currentPrompt,
    title,
    description,
    restorePrompt,
}) {
    const dispatch = useDispatch()
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(TASK_DESCRIPTION_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        removeModal(TASK_DESCRIPTION_MODAL_ID)
    }

    useEffect(() => {
        isOpenRef.current = isOpen
    }, [isOpen])

    useEffect(() => {
        return () => {
            if (isOpenRef.current) {
                dispatch(hideFloatPopup())
                removeModal(TASK_DESCRIPTION_MODAL_ID)
            }
        }
    }, [])

    return (
        <Popover
            content={
                <AssistantPromptHistoryModal
                    projectId={projectId}
                    promptField={promptField}
                    history={assistant[historyField]}
                    currentPrompt={currentPrompt}
                    title={title}
                    description={description}
                    closeModal={closeModal}
                    restorePrompt={restorePrompt}
                />
            }
            align={'center'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Button
                type={'ghost'}
                icon={'icon-note-version-history'}
                onPress={openModal}
                disabled={isOpen || disabled}
            />
        </Popover>
    )
}
