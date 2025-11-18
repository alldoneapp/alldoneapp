import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectGmailModal from './ConnectGmailModal/ConnectGmailModal'
import GoogleApi from '../../../../apis/google/GoogleApi'
import ConnectGmailButton from './ConnectGmailButton'
import { hasServerSideAuth, setServerTokenInGoogleApi } from '../../../../apis/google/GoogleOAuthServerSide'

export default function ConnectGmailProperty({ projectId, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSignedIn, setIsSignedIn] = useState(false)
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.gmail)

    // Check for server-side auth on mount and when connection status changes
    useEffect(() => {
        const checkServerAuth = async () => {
            try {
                const authStatus = await hasServerSideAuth()
                if (authStatus.hasCredentials && isConnected) {
                    // Load the server-side token into GoogleApi
                    await setServerTokenInGoogleApi(GoogleApi)
                    setIsSignedIn(true)
                } else {
                    setIsSignedIn(false)
                }
            } catch (error) {
                console.error('Error checking server auth:', error)
                setIsSignedIn(false)
            }
        }

        checkServerAuth()
    }, [isConnected])

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
