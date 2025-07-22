import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import DescriptionModal from '../../../UIComponents/FloatModals/DescriptionModal/DescriptionModal'
import { FEED_ASSISTANT_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import { updateAssistantDescription } from '../../../../utils/backends/Assistants/assistantsFirestore'

export default function DescriptionWrapper({ projectId, assistant, disabled }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(TASK_DESCRIPTION_MODAL_ID)
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
        removeModal(TASK_DESCRIPTION_MODAL_ID)
    }

    const updateDescription = description => {
        updateAssistantDescription(projectId, description, assistant)
    }

    return (
        <Popover
            content={
                <DescriptionModal
                    projectId={projectId}
                    object={assistant}
                    closeModal={closeModal}
                    objectType={FEED_ASSISTANT_OBJECT_TYPE}
                    updateDescription={updateDescription}
                    disabledTags={true}
                    disabledAttachments={true}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+D'}
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
                    shortcutText={'D'}
                />
            </Hotkeys>
        </Popover>
    )
}
