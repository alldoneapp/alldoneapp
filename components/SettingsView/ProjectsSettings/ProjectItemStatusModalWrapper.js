import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import ProjectStatusModal from '../../ProjectDetailedView/ProjectProperties/Status/ProjectStatusModal'
import Button from '../../UIControls/Button'
import { PROJECT_STATUS_MODAL_ID, removeModal, storeModal } from '../../ModalsManager/modalsManager'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_ARCHIVED, PROJECT_TYPE_TEMPLATE } from './ProjectsSettings'
import { translate } from '../../../i18n/TranslationService'
import ProjectHelper from './ProjectHelper'

export default function ProjectStatusModalWrapper({ project, activeDragMode }) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
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

    const actionButton = () => {
        const projectStatus = ProjectHelper.getTypeOfProject(loggedUser, project.id)
        switch (projectStatus) {
            case PROJECT_TYPE_ACTIVE:
                return 'circle'
            case PROJECT_TYPE_TEMPLATE:
                return 'map'
            case PROJECT_TYPE_ARCHIVED:
                return 'archive'
        }
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
            <Button
                type={'ghost'}
                icon={actionButton()}
                title={!smallScreenNavigation ? translate('Update status') : null}
                onPress={openModal}
                disabled={project.isTemplate || activeDragMode}
            />
        </Popover>
    )
}
