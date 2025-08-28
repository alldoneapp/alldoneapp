import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { updateAssistantInstructions } from '../../../../utils/backends/Assistants/assistantsFirestore'
import AssistantInstructionsModal from '../../../UIComponents/FloatModals/AssistantInstructionsModal/AssistantInstructionsModal'

export default function InstructionsWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

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

    const updateInstructions = instructions => {
        updateAssistantInstructions(projectId, assistant, instructions)
    }

    return (
        <Popover
            content={
                <AssistantInstructionsModal
                    disabled={disabled}
                    updateInstructions={updateInstructions}
                    closeModal={closeModal}
                    assistant={assistant}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+I'}
                disabled={blockShortcuts || isOpen}
                onKeyDown={(sht, event) => execShortcutFn(this.btnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.btnRef = ref)}
                    type={'ghost'}
                    icon={'edit'}
                    onPress={openModal}
                    disabled={isOpen}
                    shortcutText={'I'}
                />
            </Hotkeys>
        </Popover>
    )
}
