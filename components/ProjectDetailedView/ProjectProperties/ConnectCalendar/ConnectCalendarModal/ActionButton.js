import React, { useState } from 'react'
import { useSelector } from 'react-redux'
import moment from 'moment'

import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import Backend from '../../../../../utils/BackendBridge'
import { runHttpsCallableFunction } from '../../../../../utils/backends/firestore'
import { isSomethingConnected } from '../../../../../apis/google/ApiHelper'
import store from '../../../../../redux/store'
import { showConfirmPopup } from '../../../../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_INFO } from '../../../../UIComponents/ConfirmPopup'
import { startServerSideAuth, revokeServerSideAuth } from '../../../../../apis/google/GoogleOAuthServerSide'

export default function ActionButton({ projectId, isConnected, isSignedIn, closePopover, setIsSignedIn }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const apisConnected = useSelector(state => state.loggedUser.apisConnected)
    const [isLoading, setIsLoading] = useState(false)

    const isConnectedAndSignedIn = isConnected && isSignedIn

    const loadEvents = async () => {
        try {
            // Use the new server-side sync function
            await runHttpsCallableFunction('syncCalendarEventsSecondGen', {
                projectId,
                daysAhead: 30,
            })
        } catch (error) {
            console.error('Error loading calendar events:', error)
        }
    }

    const removeOpenEvents = () => {
        runHttpsCallableFunction('removeOldCalendarTasksSecondGen', {
            projectId: projectId,
            dateFormated: moment().format('DDMMYYYY'),
            events: [],
            removeFromAllDates: true,
        })
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
            console.error('Error in calendar connection:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const connectServerSide = async () => {
        try {
            // Start server-side OAuth flow
            await startServerSideAuth(projectId, 'calendar')

            // OAuth callback will have updated apisConnected in Firestore
            // Load calendar events
            await loadEvents()

            closePopover()
            setIsSignedIn(true)
        } catch (error) {
            console.error('Error connecting calendar:', error)
            store.dispatch(
                showConfirmPopup({
                    trigger: CONFIRM_POPUP_TRIGGER_INFO,
                    object: {
                        headerText: 'Connection failed',
                        headerTextParams: {},
                        headerQuestion: 'Failed to connect calendar. Please try again.',
                        headerQuestionParams: {},
                    },
                })
            )
        }
    }

    const disconnect = async () => {
        try {
            // Revoke server-side OAuth credentials
            await revokeServerSideAuth(projectId, 'calendar')

            // Remove calendar tasks
            removeOpenEvents()

            closePopover()
            setIsSignedIn(false)
        } catch (error) {
            console.error('Error disconnecting calendar:', error)
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
