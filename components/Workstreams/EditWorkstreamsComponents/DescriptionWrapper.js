import React, { useRef, useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { execShortcutFn } from '../../UIComponents/ShortcutCheatSheet/HelperFunctions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import DescriptionModal from '../../UIComponents/FloatModals/DescriptionModal/DescriptionModal'
import { FEED_WORKSTREAM_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../i18n/TranslationService'

export default function DescriptionWrapper({
    stream,
    updateDescription,
    projectId,
    closeEditModal,
    inMentionModal = false,
}) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)
    const descriptionBtnRef = useRef()

    const { displayName } = stream

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
        storeModal(TASK_DESCRIPTION_MODAL_ID)
    }

    const closeModal = () => {
        setTimeout(() => {
            setIsOpen(false)
            dispatch(hideFloatPopup())
            setTimeout(() => {
                removeModal(TASK_DESCRIPTION_MODAL_ID)
                if (stream?.uid != null) {
                    closeEditModal?.()
                }
            }, 400)
        })
    }

    const setDescription = description => {
        this.setTimeout(() => {
            closeModal()
            updateDescription(description)
        })
    }

    const cleanedName = displayName.trim()
    return (
        <Popover
            content={
                <DescriptionModal
                    projectId={projectId}
                    object={stream}
                    closeModal={closeModal}
                    objectType={FEED_WORKSTREAM_OBJECT_TYPE}
                    updateDescription={setDescription}
                    disabledAttachments={true}
                />
            }
            align={'start'}
            position={['bottom', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={mobile ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+D'}
                disabled={!cleanedName || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(descriptionBtnRef?.current, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={descriptionBtnRef}
                    title={inMentionModal || smallScreen ? null : translate('Description')}
                    type={'ghost'}
                    noBorder={inMentionModal || smallScreen}
                    icon={'info'}
                    buttonStyle={{ marginRight: 4 }}
                    onPress={openModal}
                    disabled={!cleanedName || isOpen}
                    shortcutText={'D'}
                />
            </Hotkeys>
        </Popover>
    )
}
