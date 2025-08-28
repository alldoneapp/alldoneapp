import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import PrivacyModal from '../PrivacyModal/PrivacyModal'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'
import { FEED_PUBLIC_FOR_ALL, FEED_TASK_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'

export default function PrivacyWrapper({ object, objectType, projectId, setPrivacy, disabled }) {
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const selectPrivacy = (isPrivate, isPublicFor) => {
        closeModal()
        setPrivacy(isPrivate, isPublicFor)
    }

    return (
        <Popover
            content={
                <PrivacyModal
                    object={object}
                    objectType={objectType}
                    projectId={projectId}
                    closePopover={closeModal}
                    delayClosePopover={closeModal}
                    savePrivacyBeforeSaveObject={selectPrivacy}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <Hotkeys
                keyName={'alt+p'}
                onKeyDown={(sht, event) => execShortcutFn(this.privacyBtnRef, openModal, event)}
                filter={e => true}
                disabled={disabled}
            >
                <Button
                    ref={ref => (this.privacyBtnRef = ref)}
                    icon={!object.isPublicFor || object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) ? 'unlock' : 'lock'}
                    iconColor={colors.Text04}
                    buttonStyle={{ backgroundColor: 'transparent', marginRight: 4 }}
                    onPress={openModal}
                    shortcutText={'P'}
                    forceShowShortcut={true}
                    accessible={false}
                    disabled={disabled}
                />
            </Hotkeys>
        </Popover>
    )
}
