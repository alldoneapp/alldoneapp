import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch } from 'react-redux'

import ProjectStatusModal from './ProjectStatusModal'
import ProjectStatusButton from './ProjectStatusButton'
import { PROJECT_STATUS_MODAL_ID, removeModal, storeModal } from '../../../ModalsManager/modalsManager'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'

export default function ProjectStatusModalWrapper({ project, disabled }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        storeModal(PROJECT_STATUS_MODAL_ID)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        removeModal(PROJECT_STATUS_MODAL_ID)
        dispatch(hideFloatPopup())
    }

    return (
        <Popover
            content={<ProjectStatusModal project={project} closeModal={closeModal} />}
            onClickOutside={closeModal}
            isOpen={isOpen}
            position={['right', 'bottom', 'left', 'top']}
            padding={4}
            align={'end'}
            contentLocation={false ? null : undefined}
        >
            <ProjectStatusButton
                projectId={project.id}
                disabled={disabled || project.isTemplate}
                openModal={openModal}
            />
        </Popover>
    )
}
