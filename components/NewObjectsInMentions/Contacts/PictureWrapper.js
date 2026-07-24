import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import { CONTACT_PICTURE_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import ImagePickerModal from '../../UIComponents/FloatModals/ImagePickerModal'
import { Picture } from '../../ContactsView/EditContact'
import ContactsHelper, { PHOTO_SIZE_300, PHOTO_SIZE_50 } from '../../ContactsView/Utils/ContactsHelper'
import { useSelector } from 'react-redux'

export default function PictureWrapper({ contact, setPicture, disabled = false }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const contactPhoto50 = ContactsHelper.getContactPhotoURL(contact, false, PHOTO_SIZE_50)
    const contactPhoto300 = ContactsHelper.getContactPhotoURL(contact, false, PHOTO_SIZE_300)

    const openModal = () => {
        setIsOpen(true)
        storeModal(CONTACT_PICTURE_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        setTimeout(() => {
            removeModal(CONTACT_PICTURE_MODAL_ID)
        }, 400)
    }

    const changePicture = photoURL => {
        setPicture(photoURL)
        closeModal()
    }

    return (
        <Popover
            content={
                <ImagePickerModal
                    closePopover={closeModal}
                    onSavePicture={changePicture}
                    picture={contactPhoto300 !== '' ? contactPhoto300 : undefined}
                    onOpenModal={this.blurInput}
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
                keyName={'alt+I'}
                disabled={disabled}
                onKeyDown={(sht, event) => execShortcutFn(this.pictureBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.pictureBtnRef = ref)}
                    icon={contactPhoto50 === '' ? 'image' : <Picture photoURL={contactPhoto50} />}
                    iconColor={contactPhoto50 === '' && colors.Text04}
                    buttonStyle={{
                        backgroundColor: 'transparent',
                        marginRight: 4,
                    }}
                    onPress={openModal}
                    disabled={disabled}
                    shortcutText={'I'}
                    forceShowShortcut={true}
                />
            </Hotkeys>
        </Popover>
    )
}
