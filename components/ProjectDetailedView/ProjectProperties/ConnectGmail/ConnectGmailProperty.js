import React, { useState, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectGmailModal from './ConnectGmailModal/ConnectGmailModal'
import GoogleApi from '../../../../apis/google/GoogleApi'
import ConnectGmailButton from './ConnectGmailButton'
import { hasServerSideAuth, setServerTokenInGoogleApi } from '../../../../apis/google/GoogleOAuthServerSide'
import { hasMicrosoftServerSideAuth } from '../../../../apis/microsoft/MicrosoftOAuthServerSide'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import { popoverToSafePosition } from '../../../../utils/HelperFunctions'
import { PROVIDER_GOOGLE, resolveEmailConnection } from '../../../../utils/IntegrationProviders'

export default function ConnectGmailProperty({ projectId, disabled }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)
    const isOpenRef = useRef(false)
    const [authStatus, setAuthStatus] = useState({ hasCredentials: false, email: null, hasModifyScope: true })
    const connection = useSelector(state => state.loggedUser.apisConnected?.[projectId])
    const resolvedConnection = resolveEmailConnection(connection)
    const isConnected = resolvedConnection.connected
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isSignedIn = authStatus.hasCredentials

    // Check for server-side auth on mount and when connection status changes
    useEffect(() => {
        const checkServerAuth = async () => {
            try {
                const provider = resolvedConnection.provider || PROVIDER_GOOGLE
                const nextAuthStatus =
                    provider === PROVIDER_GOOGLE
                        ? await hasServerSideAuth(projectId, 'gmail')
                        : await hasMicrosoftServerSideAuth(projectId, 'email')
                if (nextAuthStatus.hasCredentials && isConnected) {
                    // Load the server-side token into GoogleApi
                    if (provider === PROVIDER_GOOGLE) await setServerTokenInGoogleApi(GoogleApi, projectId, 'gmail')
                    setAuthStatus(nextAuthStatus)
                } else {
                    setAuthStatus({
                        hasCredentials: false,
                        email: null,
                        scopes: [],
                        hasModifyScope: false,
                    })
                }
            } catch (error) {
                console.error('[ConnectGmail] Error checking server auth:', error)
                setAuthStatus({
                    hasCredentials: false,
                    email: null,
                    scopes: [],
                    hasModifyScope: false,
                })
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
                <ConnectGmailModal
                    projectId={projectId}
                    authStatus={authStatus}
                    closePopover={closeModal}
                    setAuthStatus={setAuthStatus}
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
            <ConnectGmailButton
                projectId={projectId}
                disabled={disabled}
                isSignedIn={isSignedIn}
                onPress={openModal}
                needsReconnect={isConnected && isSignedIn && authStatus.hasModifyScope === false}
            />
        </Popover>
    )
}
