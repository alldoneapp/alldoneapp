import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import ConnectGmailModal from './ConnectGmailModal/ConnectGmailModal'
import GoogleApi from '../../../../apis/google/GoogleApi'
import ConnectGmailButton from './ConnectGmailButton'
import { hasServerSideAuth, setServerTokenInGoogleApi } from '../../../../apis/google/GoogleOAuthServerSide'

export default function ConnectGmailProperty({ projectId, disabled }) {
    const [isOpen, setIsOpen] = useState(false)
    const [authStatus, setAuthStatus] = useState({ hasCredentials: false, email: null, hasModifyScope: true })
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.gmail)
    const isSignedIn = authStatus.hasCredentials

    // Check for server-side auth on mount and when connection status changes
    useEffect(() => {
        const checkServerAuth = async () => {
            try {
                const nextAuthStatus = await hasServerSideAuth(projectId, 'gmail')
                if (nextAuthStatus.hasCredentials && isConnected) {
                    // Load the server-side token into GoogleApi
                    await setServerTokenInGoogleApi(GoogleApi, projectId, 'gmail')
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
                    authStatus={authStatus}
                    closePopover={closeModal}
                    setAuthStatus={setAuthStatus}
                />
            }
            onClickOutside={closeModal}
            isOpen={isOpen}
            position={['right', 'bottom', 'left', 'top']}
            padding={4}
            align={'end'}
            contentLocation={false ? null : undefined}
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
