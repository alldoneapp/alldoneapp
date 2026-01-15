import React, { useState } from 'react'
import { useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import GoogleApi from '../../../../../apis/google/GoogleApi'
import { connectToGmail } from '../../../../../utils/backends/firestore'
import store from '../../../../../redux/store'
import { showConfirmPopup } from '../../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_INFO } from '../../../../UIComponents/ConfirmPopup'
import {
    startServerSideAuth,
    revokeServerSideAuth,
    setServerTokenInGoogleApi,
} from '../../../../../apis/google/GoogleOAuthServerSide'

export default function ActionButton({ projectId, isConnected, isSignedIn, closePopover, setIsSignedIn }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const userEmail = useSelector(state => state.loggedUser.email)
    const timezone = useSelector(state => state.loggedUser.timezone)
    const [isLoading, setIsLoading] = useState(false)

    const isConnectedAndSignedIn = isConnected && isSignedIn

    const loadGmailData = async () => {
        try {
            // Set server-side token in GoogleApi for immediate use
            await setServerTokenInGoogleApi(GoogleApi, projectId, 'gmail')

            // Now get Gmail data using the GoogleApi with server-side token
            const result = await GoogleApi.listGmail()
            const email = GoogleApi.getBasicUserProfile()?.getEmail() || userEmail

            connectToGmail({
                projectId,
                date: Date.now(),
                uid: loggedUserId,
                unreadMails: result.threadsTotal,
                email,
                timezone,
            })
        } catch (error) {
            console.error('[ConnectGmail] Error loading Gmail data:', error)
        }
    }

    const onPress = async () => {
        if (isLoading) return

        setIsLoading(true)
        try {
            if (isSignedIn && isConnected) {
                await disconnect()
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
            await startServerSideAuth(projectId, 'gmail')

            // OAuth callback will have updated apisConnected in Firestore
            // Load Gmail data
            await loadGmailData()

            closePopover()
            setIsSignedIn(true)
        } catch (error) {
            console.error('[ConnectGmail] Error connecting Gmail:', error)
            store.dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_INFO,
                    object: {
                        headerText: 'Connection failed',
                        headerTextParams: {},
                        headerQuestion: 'Failed to connect Gmail. Please try again.',
                        headerQuestionParams: {},
                    },
                })
            )
        }
    }

    const disconnect = async () => {
        try {
            // Revoke server-side OAuth credentials
            await revokeServerSideAuth(projectId, 'gmail')

            closePopover()
            setIsSignedIn(false)
        } catch (error) {
            console.error('[ConnectGmail] Error disconnecting Gmail:', error)
        }
    }

    return (
        <Button
            title={translate(isConnectedAndSignedIn ? 'Disconnect' : 'Connect')}
            icon={isConnectedAndSignedIn ? 'unlink' : 'link'}
            buttonStyle={{ alignSelf: 'center' }}
            onPress={onPress}
            disabled={isLoading}
            processing={isLoading}
            processingTitle={translate(isConnectedAndSignedIn ? 'google_api_disconnecting' : 'google_api_connecting')}
        />
    )
}
