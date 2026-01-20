import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'

import ContactStatusButton from './ContactStatusButton'
import ContactStatusModal from './ContactStatusModal'
import { setProjectContactStatus } from '../../../../utils/backends/Contacts/contactsFirestore'

export default function ContactStatusWrapper({ disabled, projectId, currentStatusId, contact }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    const updateStatus = statusId => {
        setProjectContactStatus(projectId, contact, contact.uid, statusId)
    }

    return (
        <Popover
            key={!isOpen}
            content={
                <ContactStatusModal
                    closeModal={closeModal}
                    updateStatus={updateStatus}
                    projectId={projectId}
                    currentStatusId={currentStatusId}
                />
            }
            align={'start'}
            position={['bottom', 'left', 'right', 'top']}
            onClickOutside={closeModal}
            isOpen={isOpen}
            contentLocation={smallScreenNavigation ? null : undefined}
        >
            <ContactStatusButton
                projectId={projectId}
                disabled={disabled}
                statusId={currentStatusId}
                onPress={openModal}
            />
        </Popover>
    )
}
