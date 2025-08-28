import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import PreConfigTaskModal from '../../../UIComponents/FloatModals/PreConfigTaskModal/PreConfigTaskModal'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'
import { TouchableOpacity } from 'react-native'

export default function AddPreConfigTaskWrapper({ disabled, projectId, assistantId, task, adding, children }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    return (
        <Popover
            content={
                <PreConfigTaskModal
                    projectId={projectId}
                    closeModal={closeModal}
                    adding={adding}
                    assistantId={assistantId}
                    task={task}
                    disabled={disabled}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={null}
        >
            {children ? (
                <TouchableOpacity onPress={openModal} disabled={disabled || isOpen}>
                    {children}
                </TouchableOpacity>
            ) : adding ? (
                <Hotkeys
                    keyName={'alt+C'}
                    disabled={blockShortcuts}
                    onKeyDown={(sht, event) => execShortcutFn(this.btnRef, openModal, event)}
                    filter={e => true}
                >
                    <Button
                        ref={ref => (this.btnRef = ref)}
                        type={'ghost'}
                        icon={'add-task'}
                        title={translate('Add new')}
                        onPress={openModal}
                        disabled={isOpen}
                        shortcutText={'C'}
                        buttonStyle={{
                            width: '100%',
                        }}
                    />
                </Hotkeys>
            ) : (
                <Button
                    ref={ref => (this.btnRef = ref)}
                    type={'ghost'}
                    icon={'edit'}
                    onPress={openModal}
                    disabled={isOpen}
                />
            )}
        </Popover>
    )
}
