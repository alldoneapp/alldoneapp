import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import AssistantTypeModal from '../../../UIComponents/FloatModals/AssistantTypeModal/AssistantTypeModal'
import {
    updateAssistantPrompt,
    updateAssistantThirdPartLink,
} from '../../../../utils/backends/Assistants/assistantsFirestore'
import { TYPE_PROMPT_BASED } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function TypeOfAssistantWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { type, prompt, thirdPartLink } = assistant

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

    const updatePrompt = prompt => {
        updateAssistantPrompt(projectId, assistant, prompt)
    }

    const updateThirdPartLink = thirdPartLink => {
        updateAssistantThirdPartLink(projectId, assistant, thirdPartLink)
    }

    return (
        <Popover
            content={
                <AssistantTypeModal
                    closeModal={closeModal}
                    updatePrompt={updatePrompt}
                    updateThirdPartLink={updateThirdPartLink}
                    initialType={type}
                    initialPrompt={prompt}
                    initialThirdPartLink={thirdPartLink}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+P'}
                disabled={blockShortcuts || isOpen || disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.btnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.btnRef = ref)}
                    type={'ghost'}
                    icon={'edit'}
                    onPress={openModal}
                    disabled={isOpen || disabled}
                    shortcutText={'P'}
                    title={type === TYPE_PROMPT_BASED ? 'Prompt' : '3rd party'}
                />
            </Hotkeys>
        </Popover>
    )
}
