import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { ATTACHMENTS_SELECTOR_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { useSelector } from 'react-redux'
import AttachmentsSelectorModal from '../../UIComponents/FloatModals/AttachmentsSelectorModal'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'

export default function AttachmentWrapper({ projectId, addAttachmentTag, disabled = false }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        if (!checkIsLimitedByTraffic(projectId)) {
            setIsOpen(true)
            storeModal(ATTACHMENTS_SELECTOR_MODAL_ID)
        }
    }

    const closeModal = () => {
        setIsOpen(false)
        setTimeout(() => {
            removeModal(ATTACHMENTS_SELECTOR_MODAL_ID)
        }, 400)
    }

    const addAttachment = (text, uri) => {
        addAttachmentTag(text, uri)
        closeModal()
    }

    return (
        <Popover
            content={
                <AttachmentsSelectorModal
                    projectId={projectId}
                    closeModal={closeModal}
                    addAttachmentTag={addAttachment}
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
                keyName={'alt+U'}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.fileBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.fileBtnRef = ref)}
                    icon={'folder-plus'}
                    iconColor={colors.Text04}
                    buttonStyle={{
                        backgroundColor: 'transparent',
                        marginRight: 4,
                    }}
                    onPress={openModal}
                    disabled={disabled}
                    shortcutText={'U'}
                    forceShowShortcut={true}
                />
            </Hotkeys>
        </Popover>
    )
}
