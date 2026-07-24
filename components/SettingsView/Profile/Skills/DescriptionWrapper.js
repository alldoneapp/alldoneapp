import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'

import Button from '../../../UIControls/Button'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { execShortcutFn } from '../../../../utils/HelperFunctions'
import { TASK_DESCRIPTION_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import DescriptionModal from '../../../UIComponents/FloatModals/DescriptionModal/DescriptionModal'
import { translate } from '../../../../i18n/TranslationService'
import { FEED_SKILL_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'

export default function DescriptionWrapper({ skill, updateDescription, projectId, disabled }) {
    const dispatch = useDispatch()
    const blockShortcuts = useSelector(state => state.blockShortcuts)
    const smallScreen = useSelector(state => state.smallScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

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
            }, 400)
        })
    }

    const setDescription = description => {
        this.setTimeout(() => {
            closeModal()
            updateDescription(description)
        })
    }

    return (
        <Popover
            content={
                <DescriptionModal
                    projectId={projectId}
                    object={skill}
                    closeModal={closeModal}
                    objectType={FEED_SKILL_OBJECT_TYPE}
                    updateDescription={setDescription}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <Hotkeys
                keyName={'alt+D'}
                disabled={disabled || blockShortcuts}
                onKeyDown={(sht, event) => execShortcutFn(this.descriptionBtnRef, openModal, event)}
                filter={e => true}
            >
                <Button
                    ref={ref => (this.descriptionBtnRef = ref)}
                    title={smallScreen ? null : translate('Description')}
                    type={'ghost'}
                    noBorder={smallScreen}
                    icon={'info'}
                    buttonStyle={{ marginHorizontal: smallScreen ? 4 : 2 }}
                    onPress={openModal}
                    disabled={disabled}
                    shortcutText={'D'}
                />
            </Hotkeys>
        </Popover>
    )
}
