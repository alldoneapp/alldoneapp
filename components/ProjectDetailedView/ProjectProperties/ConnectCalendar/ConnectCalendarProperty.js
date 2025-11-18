import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectCalendarModal from './ConnectCalendarModal/ConnectCalendarModal'
import GoogleApi from '../../../../apis/google/GoogleApi'
import ConnectCalendarButton from './ConnectCalendarButton'
import { hasServerSideAuth, setServerTokenInGoogleApi } from '../../../../apis/google/GoogleOAuthServerSide'

export default function ConnectCalendarProperty({ projectId, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSignedIn, setIsSignedIn] = useState(false)
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendar)

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
