import React, { useState } from 'react'
import { useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import { fetchEmailLineSummary } from '../../../../../utils/backends/EmailLine/emailLineBackend'
import store from '../../../../../redux/store'
import { showConfirmPopup } from '../../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_INFO } from '../../../../UIComponents/ConfirmPopup'
import {
    hasServerSideAuth,
    startServerSideAuth,
    revokeServerSideAuth,
} from '../../../../../apis/google/GoogleOAuthServerSide'
import {
    hasMicrosoftServerSideAuth,
    revokeMicrosoftServerSideAuth,
    startMicrosoftServerSideAuth,
} from '../../../../../apis/microsoft/MicrosoftOAuthServerSide'
import { PROVIDER_MICROSOFT } from '../../../../../utils/IntegrationProviders'

export default function ActionButton({ projectId, isConnected, authStatus, provider, closePopover, setAuthStatus }) {
    const [isLoading, setIsLoading] = useState(false)

    const isSignedIn = !!authStatus?.hasCredentials
    const isConnectedAndSignedIn = isConnected && authStatus?.hasCredentials && authStatus?.hasModifyScope !== false

    const loadGmailData = async () => {
        try {
            if (provider === PROVIDER_MICROSOFT) return

            // Prime the email line summary so the label chips appear right after
            // connecting. The server callable reads the freshly-written OAuth
            // connection from Firestore.
            await fetchEmailLineSummary(projectId, { force: true })
        } catch (error) {
            console.error('[ConnectGmail] Error loading Gmail data:', error)
        }
    }

    const onPress = async () => {
        if (isLoading) return

        setIsLoading(true)
        try {
            if (isSignedIn && isConnected) {
                if (isConnectedAndSignedIn) {
                    await disconnect()
                } else {
                    await connectServerSide()
                }
            } else {
                await connectServerSide()
            }
        } catch (error) {
            console.error('[ConnectGmail] Error in Gmail connection:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const connectServerSide = async () => {
        try {
            // Start server-side OAuth flow (includes Gmail scopes)
            if (provider === PROVIDER_MICROSOFT) {
                await startMicrosoftServerSideAuth(projectId, 'email')
                const nextAuthStatus = await hasMicrosoftServerSideAuth(projectId, 'email')
                closePopover()
                setAuthStatus(nextAuthStatus)
                return
            }

            await startServerSideAuth(projectId, 'gmail')

            // OAuth callback will have updated apisConnected in Firestore
            // Load Gmail data
            await loadGmailData()
            const nextAuthStatus = await hasServerSideAuth(projectId, 'gmail')

            closePopover()
            setAuthStatus(nextAuthStatus)
        } catch (error) {
            console.error('[ConnectGmail] Error connecting Gmail:', error)
            store.dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_INFO,
                    object: {
                        headerText: 'Connection failed',
                        headerTextParams: {},
                        headerQuestion: 'Failed to connect email. Please try again.',
                        headerQuestionParams: {},
                    },
                })
            )
        }
    }

    const disconnect = async () => {
        try {
            // Revoke server-side OAuth credentials
            if (provider === PROVIDER_MICROSOFT) {
                await revokeMicrosoftServerSideAuth(projectId, 'email')
            } else {
                await revokeServerSideAuth(projectId, 'gmail')
            }

            closePopover()
            setAuthStatus({ hasCredentials: false, email: null, scopes: [], hasModifyScope: false })
        } catch (error) {
            console.error('[ConnectEmail] Error disconnecting email:', error)
        }
    }

    return (
        <Button
            title={translate(
                isConnectedAndSignedIn ? 'Disconnect' : authStatus?.hasCredentials ? 'Reconnect' : 'Connect'
            )}
            icon={isConnectedAndSignedIn ? 'unlink' : 'link'}
            buttonStyle={{ alignSelf: 'center' }}
            onPress={onPress}
            disabled={isLoading}
            processing={isLoading}
            processingTitle={translate(isConnectedAndSignedIn ? 'google_api_disconnecting' : 'google_api_connecting')}
        />
    )
}
