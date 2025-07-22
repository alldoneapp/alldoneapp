import React from 'react'
import { useSelector } from 'react-redux'

import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import Backend from '../../../../../utils/BackendBridge'
import GooleApi from '../../../../../apis/google/GooleApi'
import { connectToGmail } from '../../../../../utils/backends/firestore'
import { disableOtherProjects, isSomethingConnected } from '../../../../../apis/google/ApiHelper'

export default function ActionButton({ projectId, isConnected, isSignedIn, closePopover, setIsSignedIn }) {
    const email = useSelector(state => state.loggedUser.email)
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const isConnectedAndSignedIn = isConnected && isSignedIn

    const loadEvents = () => {
        GooleApi.listGmail().then(result => {
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
        Backend.getDb()
            .doc(`users/${loggedUserId}`)
            .set({ apisConnected: { [projectId]: { gmail: true } } }, { merge: true })
            .then(loadEvents)
        closePopover()
        setIsSignedIn(GooleApi.checkGmailAccessGranted())
        disableOtherProjects(projectId)
    }

    const onPress = () => {
        !isSomethingConnected() && GooleApi.handleSignOutClick()
        if (isSignedIn && isConnected) {
            disconnect()
        } else {
            GooleApi.handleGmailAuthClick().then(connect)
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
