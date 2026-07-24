import React, { useEffect, useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import AssistantDelegationTargetsModal from '../../../UIComponents/FloatModals/AssistantDelegationTargetsModal/AssistantDelegationTargetsModal'
import { updateAssistantDelegationTargets } from '../../../../utils/backends/Assistants/assistantsFirestore'

export default function DelegationTargetsAccessWrapper({
    disabled,
    projectId,
    assistant,
    availableTargets,
    selectionCount,
}) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)

    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)

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

    const applySelection = ({ selectedTargetKeys, useDefaultAll }) => {
        updateAssistantDelegationTargets(projectId, assistant, selectedTargetKeys, useDefaultAll)
    }

    const buttonLabel = `${translate('Edit')} (${selectionCount}/${availableTargets.length})`

    return (
        <Popover
            content={
                <AssistantDelegationTargetsModal
                    assistant={assistant}
                    availableTargets={availableTargets}
                    onApply={applySelection}
                    closeModal={closeModal}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+J'}
                disabled={blockShortcuts || isOpen || disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.btnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.btnRef = ref)}
                    type={'ghost'}
                    icon={'edit-2'}
                    onPress={openModal}
                    disabled={isOpen || disabled}
                    shortcutText={'J'}
                    title={buttonLabel}
                />
            </Hotkeys>
        </Popover>
    )
}
