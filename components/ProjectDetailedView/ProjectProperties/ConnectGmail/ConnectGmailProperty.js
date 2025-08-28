import React, { useState } from 'react'
import Popover from 'react-tiny-popover'

import ConnectGmailModal from './ConnectGmailModal/ConnectGmailModal'
import GooleApi from '../../../../apis/google/GooleApi'
import ConnectGmailButton from './ConnectGmailButton'

export default function ConnectGmailProperty({ projectId, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSignedIn, setIsSignedIn] = useState(GooleApi.checkGmailAccessGranted)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    return (
        <Popover
            content={
                <ConnectGmailModal
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
            <ConnectGmailButton projectId={projectId} disabled={disabled} isSignedIn={isSignedIn} onPress={openModal} />
        </Popover>
    )
}
