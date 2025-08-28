import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { updateAssistantTemperature } from '../../../../utils/backends/Assistants/assistantsFirestore'
import {
    TEMPERATURE_HIGH,
    TEMPERATURE_LOW,
    TEMPERATURE_NORMAL,
    TEMPERATURE_VERY_HIGH,
    TEMPERATURE_VERY_LOW,
} from '../../../AdminPanel/Assistants/assistantsHelper'
import { translate } from '../../../../i18n/TranslationService'
import AssistantTemperatureModal from '../../../UIComponents/FloatModals/AssistantTemperatureModal/AssistantTemperatureModal'

export default function TemperatureWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { temperature } = assistant

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const updateTemperature = temperature => {
        updateAssistantTemperature(projectId, assistant, temperature)
    }

    const getTemperatureText = () => {
        if (temperature === TEMPERATURE_VERY_LOW) return 'Very low'
        if (temperature === TEMPERATURE_LOW) return 'Low'
        if (temperature === TEMPERATURE_NORMAL) return 'Normal'
        if (temperature === TEMPERATURE_HIGH) return 'High'
        if (temperature === TEMPERATURE_VERY_HIGH) return 'Very high'
    }

    return (
        <Popover
            content={
                <AssistantTemperatureModal
                    updateTemperature={updateTemperature}
                    closeModal={closeModal}
                    temperature={temperature}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+T'}
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
                    shortcutText={'T'}
                    title={translate(getTemperatureText())}
                />
            </Hotkeys>
        </Popover>
    )
}
