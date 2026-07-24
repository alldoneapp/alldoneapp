import React, { useState, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectCalendarModal from './ConnectCalendarModal/ConnectCalendarModal'
import GoogleApi from '../../../../apis/google/GoogleApi'
import ConnectCalendarButton from './ConnectCalendarButton'
import { hasServerSideAuth, setServerTokenInGoogleApi } from '../../../../apis/google/GoogleOAuthServerSide'
import { hasMicrosoftServerSideAuth } from '../../../../apis/microsoft/MicrosoftOAuthServerSide'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { popoverToSafePosition } from '../../../../utils/HelperFunctions'
import { PROVIDER_GOOGLE, resolveCalendarConnection } from '../../../../utils/IntegrationProviders'

export default function ConnectCalendarProperty({ projectId, disabled }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)
    const [isSignedIn, setIsSignedIn] = useState(false)
    const connection = useSelector(state => state.loggedUser.apisConnected?.[projectId])
    const resolvedConnection = resolveCalendarConnection(connection)
    const isConnected = resolvedConnection.connected
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    // Check for server-side auth on mount and when connection status changes
    useEffect(() => {
        const checkServerAuth = async () => {
            try {
                const provider = resolvedConnection.provider || PROVIDER_GOOGLE
                const authStatus =
                    provider === PROVIDER_GOOGLE
                        ? await hasServerSideAuth(projectId, 'calendar')
                        : await hasMicrosoftServerSideAuth(projectId, 'calendar')
                if (authStatus.hasCredentials && isConnected) {
                    // Load the server-side token into GoogleApi
                    if (provider === PROVIDER_GOOGLE) await setServerTokenInGoogleApi(GoogleApi, projectId, 'calendar')
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
    }, [isConnected, resolvedConnection.provider])

    const openModal = () => {
        if (isOpenRef.current) return
        isOpenRef.current = true
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (!isOpenRef.current) return
        isOpenRef.current = false
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    useEffect(() => {
        return () => {
            if (isOpenRef.current) {
                isOpenRef.current = false
                dispatch(hideFloatPopup())
            }
        }
    }, [dispatch])

    return (
        <Popover
            content={
                <ConnectCalendarModal
                    projectId={projectId}
                    isSignedIn={isSignedIn}
                    provider={resolvedConnection.provider}
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
            disableReposition={true}
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
