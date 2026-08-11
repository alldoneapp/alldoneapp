import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import ConfirmDoneMilestoneModal from '../UIComponents/FloatModals/ConfirmDoneMilestoneModal'
import DoneStateButton from './DoneStateButton'
import Backend from '../../utils/BackendBridge'
import { translate } from '../../i18n/TranslationService'

export default function DoneStateWrapper({ projectId, milestone }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const loggedUser = useSelector(state => state.loggedUser)
    const [showModal, setShowModal] = useState(false)
    const [checked, setChecked] = useState(milestone.done)
    const dispatch = useDispatch()

    const openModal = () => {
        setChecked(!milestone.done)
        setShowModal(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setChecked(milestone.done)
        setShowModal(false)
        dispatch(hideFloatPopup())
    }

    const moveMilestoneToDone = () => {
        setShowModal(false)
        dispatch(hideFloatPopup())
        Backend.updateMilestoneDoneState(projectId, milestone)
    }

    const moveMilestoneToOpen = () => {
        setChecked(!milestone.done)
        Backend.updateMilestoneDoneState(projectId, milestone)
    }

    return (
        <Popover
            content={
                <ConfirmDoneMilestoneModal
                    projectId={projectId}
                    milestoneDate={milestone.date}
                    moveMilestoneToDone={moveMilestoneToDone}
                    closeModal={closeModal}
                />
            }
            onClickOutside={closeModal}
            isOpen={showModal}
            position={['top', 'right', 'bottom', 'left']}
            padding={4}
            align={'start'}
            disableReposition={mobile}
            contentLocation={mobile ? null : undefined}
        >
            <DoneStateButton
                text={translate(milestone.done ? 'Done mile' : 'In progress')}
                onPress={milestone.done ? moveMilestoneToOpen : openModal}
                inDone={milestone.done}
                checked={checked}
                disabled={loggedUser.isAnonymous}
            />
        </Popover>
    )
}
