import React from 'react'
import { useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import Backend from '../../../../../utils/BackendBridge'
import GoogleApi from '../../../../../apis/google/GoogleApi'
import { connectToGmail } from '../../../../../utils/backends/firestore'
import { isSomethingConnected } from '../../../../../apis/google/ApiHelper'

export default function ActionButton({ projectId, isConnected, isSignedIn, closePopover, setIsSignedIn }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const userEmail = useSelector(state => state.loggedUser.email)

    const isConnectedAndSignedIn = isConnected && isSignedIn

    const loadEvents = () => {
        GoogleApi.listGmail().then(result => {
            const email = GoogleApi.getBasicUserProfile()?.getEmail() || userEmail
            connectToGmail({
                projectId,
                date: Date.now(),
                uid: loggedUserId,
                unreadMails: result.threadsTotal,
                email,
            })
        })
    }

    const disconnect = () => {
        Backend.getDb()
            .doc(`users/${loggedUserId}`)
            .set({ apisConnected: { [projectId]: { gmail: false } } }, { merge: true })
        closePopover()
    }

    const connect = () => {
        const email = GoogleApi.getBasicUserProfile()?.getEmail() || userEmail
        Backend.getDb()
            .doc(`users/${loggedUserId}`)
            .set({ apisConnected: { [projectId]: { gmail: true, gmailEmail: email } } }, { merge: true })
            .then(loadEvents)
        closePopover()
        setIsSignedIn(GoogleApi.checkGmailAccessGranted())
    }

    const onPress = () => {
        !isSomethingConnected() && GoogleApi.handleSignOutClick()
        if (isSignedIn && isConnected) {
            disconnect()
        } else {
            GoogleApi.handleGmailAuthClick().then(connect)
        }
    }

    return (
        <Button
            title={translate(isConnectedAndSignedIn ? 'Disconnect' : 'Connect')}
            icon={isConnectedAndSignedIn ? 'unlink' : 'link'}
            buttonStyle={{ alignSelf: 'center' }}
            onPress={onPress}
        />
    )
}
