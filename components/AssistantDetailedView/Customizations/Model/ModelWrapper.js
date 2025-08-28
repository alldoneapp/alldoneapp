import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { updateAssistantModel } from '../../../../utils/backends/Assistants/assistantsFirestore'
import AssistantModelModal from '../../../UIComponents/FloatModals/AssistantModelModal/AssistantModelModal'
import {
    MODEL_GPT3_5,
    MODEL_GPT4,
    MODEL_GPT4O,
    MODEL_SONAR,
    MODEL_SONAR_PRO,
    MODEL_SONAR_REASONING,
    MODEL_SONAR_REASONING_PRO,
    MODEL_SONAR_DEEP_RESEARCH,
} from '../../../AdminPanel/Assistants/assistantsHelper'
import { translate } from '../../../../i18n/TranslationService'

export default function ModelWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const { model } = assistant

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const updateModel = model => {
        updateAssistantModel(projectId, assistant, model)
    }

    const getModelText = () => {
        if (model === MODEL_GPT3_5) return 'GPT 3_5'
        if (model === MODEL_GPT4) return 'GPT 4'
        if (model === MODEL_GPT4O) return 'GPT 4o'
        if (model === MODEL_SONAR) return 'Sonar'
        if (model === MODEL_SONAR_PRO) return 'Sonar Pro'
        if (model === MODEL_SONAR_REASONING) return 'Sonar Reasoning'
        if (model === MODEL_SONAR_REASONING_PRO) return 'Sonar Reasoning Pro'
        if (model === MODEL_SONAR_DEEP_RESEARCH) return 'Sonar Deep Research'
        return model // return the model key as fallback
    }

    return (
        <Popover
            content={<AssistantModelModal updateModel={updateModel} closeModal={closeModal} model={model} />}
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+M'}
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
                    shortcutText={'M'}
                    title={translate(getModelText())}
                />
            </Hotkeys>
        </Popover>
    )
}
