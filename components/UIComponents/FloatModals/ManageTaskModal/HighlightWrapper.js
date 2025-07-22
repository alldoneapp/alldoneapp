import React, { useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import HighlightColorModal from '../HighlightColorModal/HighlightColorModal'
import Circle from '../HighlightColorModal/Circle'
import { HIGHLIGHT_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'

export default function HighlightWrapper({ object, setColor, disabled = false }) {
    const [isOpen, setIsOpen] = useState(false)
    const highlightBtnRef = useRef()

    const openModal = () => {
        setIsOpen(true)
        storeModal(HIGHLIGHT_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        setTimeout(() => {
            removeModal(HIGHLIGHT_MODAL_ID)
        }, 400)
    }

    const selectColor = (e, data) => {
        closeModal()
        setColor(data.color)
    }

    return (
        <Popover
            content={<HighlightColorModal onPress={selectColor} selectedColor={object.hasStar} />}
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <Hotkeys
                keyName={'alt+h'}
                onKeyDown={(sht, event) => execShortcutFn(highlightBtnRef.current, openModal, event)}
                filter={e => true}
                disabled={disabled}
            >
                <Button
                    ref={highlightBtnRef}
                    icon={<Circle color={object.hasStar} inButton={true} icoForcedColor={colors.Text04} />}
                    iconColor={colors.Text04}
                    buttonStyle={{
                        backgroundColor: 'transparent',
                        marginRight: 4,
                    }}
                    onPress={openModal}
                    shortcutText={'H'}
                    forceShowShortcut={true}
                    disabled={disabled}
                />
            </Hotkeys>
        </Popover>
    )
}
