import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import AssistantToolsModal from '../../../UIComponents/FloatModals/AssistantToolsModal/AssistantToolsModal'
import { updateAssistant } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { TOOL_LABEL_BY_KEY, TOOL_OPTIONS } from './toolOptions'

export default function ToolsAccessWrapper({ disabled, projectId, assistant }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)

    const [isOpen, setIsOpen] = useState(false)

    const allowedTools = Array.isArray(assistant.allowedTools) ? assistant.allowedTools : []

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const applyTools = tools => {
        updateAssistant(projectId, { ...assistant, allowedTools: tools }, assistant)
    }

    const buttonLabel = !allowedTools.length
        ? translate('No tools enabled')
        : allowedTools.length === TOOL_OPTIONS.length
        ? translate('All tools enabled')
        : allowedTools.map(key => translate(TOOL_LABEL_BY_KEY[key] || key)).join(', ')

    return (
        <Popover
            content={<AssistantToolsModal allowedTools={allowedTools} onApply={applyTools} closeModal={closeModal} />}
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+O'}
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
                    shortcutText={'O'}
                    title={buttonLabel}
                />
            </Hotkeys>
        </Popover>
    )
}
