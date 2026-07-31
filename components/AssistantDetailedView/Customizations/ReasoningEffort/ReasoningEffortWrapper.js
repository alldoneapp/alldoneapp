import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { updateAssistantReasoningEffort } from '../../../../utils/backends/Assistants/assistantsFirestore'
import AssistantReasoningEffortModal from '../../../UIComponents/FloatModals/AssistantReasoningEffortModal/AssistantReasoningEffortModal'
import { translate } from '../../../../i18n/TranslationService'

export default function ReasoningEffortWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)
    const reasoningEffort = ['low', 'medium', 'high'].includes(assistant.reasoningEffort)
        ? assistant.reasoningEffort
        : null

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

    const getEffortText = () => {
        if (!reasoningEffort) return 'Model default'
        return reasoningEffort[0].toUpperCase() + reasoningEffort.slice(1)
    }

    return (
        <Popover
            content={
                <AssistantReasoningEffortModal
                    closeModal={closeModal}
                    reasoningEffort={reasoningEffort}
                    updateReasoningEffort={value => updateAssistantReasoningEffort(projectId, assistant, value)}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+E'}
                disabled={blockShortcuts || isOpen || disabled}
                onKeyDown={(shortcut, event) => execShortcutFn(this.btnRef, openModal, event)}
                filter={event => true}
            >
                <Button
                    ref={ref => (this.btnRef = ref)}
                    type={'ghost'}
                    icon={'edit-2'}
                    onPress={openModal}
                    disabled={isOpen || disabled}
                    shortcutText={'E'}
                    title={translate(getEffortText())}
                />
            </Hotkeys>
        </Popover>
    )
}
