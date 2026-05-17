import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectCalendarModal from './ConnectCalendarModal/ConnectCalendarModal'
import GoogleApi from '../../../../apis/google/GoogleApi'
import ConnectCalendarButton from './ConnectCalendarButton'
import { hasServerSideAuth, setServerTokenInGoogleApi } from '../../../../apis/google/GoogleOAuthServerSide'
import { popoverToSafePosition } from '../../../../utils/HelperFunctions'

export default function ConnectCalendarProperty({ projectId, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    const [isSignedIn, setIsSignedIn] = useState(false)
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendar)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    // Check for server-side auth on mount and when connection status changes
    useEffect(() => {
        const checkServerAuth = async () => {
            try {
                const authStatus = await hasServerSideAuth(projectId, 'calendar')
                if (authStatus.hasCredentials && isConnected) {
                    // Load the server-side token into GoogleApi
                    await setServerTokenInGoogleApi(GoogleApi, projectId, 'calendar')
                    setIsSignedIn(true)
                } else {
                    setIsSignedIn(false)
                }
            } catch (error) {
                console.error('[ConnectCalendar] Error checking server auth:', error)
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
            windowBorderPadding={16}
            align={'end'}
            contentLocation={args => popoverToSafePosition(args, smallScreenNavigation)}
            containerStyle={{
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: 'calc(100vh - 32px)',
                overflow: 'visible',
                zIndex: '9999',
            }}
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
