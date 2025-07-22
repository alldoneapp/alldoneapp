import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { removeModal, STICKY_MODAL_ID, storeModal } from '../../ModalsManager/modalsManager'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { useSelector } from 'react-redux'
import SelectStickynessPopup from '../../NotesView/NotesDV/PropertiesView/SelectStickynessPopup'

export default function StickyWrapper({ note, projectId, setSticky, disabled = false }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        storeModal(STICKY_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        setTimeout(() => {
            removeModal(STICKY_MODAL_ID)
        }, 400)
    }

    const changeSticky = stickyData => {
        setSticky(stickyData)
        closeModal()
    }

    return (
        <Popover
            content={
                <SelectStickynessPopup
                    projectId={projectId}
                    note={note}
                    hidePopover={closeModal}
                    saveStickyBeforeSaveNote={changeSticky}
                />
            }
            onClickOutside={closeModal}
            isOpen={isOpen}
            align={'start'}
            position={['bottom']}
            padding={4}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+Y'}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.stickyBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.stickyBtnRef = ref)}
                    icon={'sticky-note'}
                    iconColor={colors.Text04}
                    buttonStyle={{
                        backgroundColor: 'transparent',
                        marginRight: 4,
                    }}
                    onPress={openModal}
                    disabled={disabled}
                    shortcutText={'Y'}
                    forceShowShortcut={true}
                />
            </Hotkeys>
        </Popover>
    )
}
