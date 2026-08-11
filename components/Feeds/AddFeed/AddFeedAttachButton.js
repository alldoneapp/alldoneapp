import React, { useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import Button from '../../UIControls/Button'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import Hotkeys from 'react-hot-keys'
import AttachmentsSelectorModal from '../../UIComponents/FloatModals/AttachmentsSelectorModal'
import { translate } from '../../../i18n/TranslationService'
import { checkIsLimitedByTraffic } from '../../Premium/PremiumHelper'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'

export default function AddFeedAttachButton({
    subscribeClickObserver,
    unsubscribeClickObserver,
    isDisabled,
    smallScreen,
    addAttachmentTag,
    projectId,
}) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const attachBtnRef = useRef()
    const [showModal, setShowModal] = useState(false)

    const openModal = () => {
        if (!checkIsLimitedByTraffic(projectId)) {
            unsubscribeClickObserver()
            setShowModal(true)
            dispatch(showFloatPopup())
        }
    }
    const closeModal = () => {
        subscribeClickObserver()
        setShowModal(false)
        dispatch(hideFloatPopup())
    }

    return (
        <Popover
            content={
                <AttachmentsSelectorModal
                    closeModal={closeModal}
                    addAttachmentTag={addAttachmentTag}
                    projectId={projectId}
                />
            }
            onClickOutside={closeModal}
            isOpen={showModal}
            position={['bottom', 'top', 'right', 'left']}
            padding={4}
            align={'start'}
        >
            <Hotkeys
                keyName={'alt+U'}
                disabled={isDisabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(attachBtnRef.current, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={attachBtnRef}
                    title={smallScreen ? null : translate('Add')}
                    type={'ghost'}
                    noBorder={smallScreen}
                    icon={'folder-plus'}
                    buttonStyle={{ marginRight: 4 }}
                    onPress={openModal}
                    disabled={isDisabled}
                    shortcutText={'U'}
                />
            </Hotkeys>
        </Popover>
    )
}
