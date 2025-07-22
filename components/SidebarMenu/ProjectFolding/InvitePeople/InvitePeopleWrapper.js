import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import InvitePeopleButton from './InvitePeopleButton'
import InvitePeopleModal from './InvitePeopleModal'

export default function InvitePeopleWrapper({ projectColor, projectIndex }) {
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    return (
        <Popover
            content={<InvitePeopleModal projectIndex={projectIndex} closeModal={closeModal} />}
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <InvitePeopleButton projectColor={projectColor} openModal={openModal} />
        </Popover>
    )
}
