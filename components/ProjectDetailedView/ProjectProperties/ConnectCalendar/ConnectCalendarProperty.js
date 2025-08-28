import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import ConnectCalendarModal from './ConnectCalendarModal/ConnectCalendarModal'
import GooleApi from '../../../../apis/google/GooleApi'
import ConnectCalendarButton from './ConnectCalendarButton'

export default function ConnectCalendarProperty({ projectId, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSignedIn, setIsSignedIn] = useState(GooleApi.checkAccessGranted)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    return (
        <Popover
            content={
                <ConnectCalendarModal
                    projectId={projectId}
                    isSignedIn={isSignedIn}
                    closePopover={closeModal}
                    setIsSignedIn={setIsSignedIn}
                />
            }
            onClickOutside={closeModal}
            isOpen={isOpen}
            position={['right', 'bottom', 'left', 'top']}
            padding={4}
            align={'end'}
            contentLocation={false ? null : undefined}
        >
            <ConnectCalendarButton
                projectId={projectId}
                disabled={disabled}
                isSignedIn={isSignedIn}
                onPress={openModal}
            />
        </Popover>
    )
}
