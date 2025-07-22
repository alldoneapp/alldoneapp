import React from 'react'
import { useSelector } from 'react-redux'
import moment from 'moment'

import Button from '../../../../UIControls/Button'
import { translate } from '../../../../../i18n/TranslationService'
import Backend from '../../../../../utils/BackendBridge'
import GooleApi from '../../../../../apis/google/GooleApi'
import { runHttpsCallableFunction } from '../../../../../utils/backends/firestore'
import { disableOtherProjects, isSomethingConnected } from '../../../../../apis/google/ApiHelper'

export default function ActionButton({ projectId, isConnected, isSignedIn, closePopover, setIsSignedIn }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const isConnectedAndSignedIn = isConnected && isSignedIn

    const loadEvents = () => {
        GooleApi.listTodayEvents(30).then(({ result }) => {
            runHttpsCallableFunction('addCalendarEventsToTasksSecondGen', {
                events: result?.items,
                projectId,
                uid: loggedUserId,
                email: result.summary,
            })
        })
    }

    const removeOpenEvents = () => {
        runHttpsCallableFunction('removeOldCalendarTasksSecondGen', {
            uid: loggedUserId,
            dateFormated: moment().format('DDMMYYYY'),
            events: [],
            removeFromAllDates: true,
        })
    }

    const onPress = () => {
        !isSomethingConnected() && GooleApi.handleSignOutClick()
        if (isSignedIn && isConnected) {
            disconnect()
        } else {
            GooleApi.handleAuthClick().then(connect)
        }
    }

    const disconnect = () => {
        Backend.getDb()
            .doc(`users/${loggedUserId}`)
            .set({ apisConnected: { [projectId]: { calendar: false } } }, { merge: true })
            .then(removeOpenEvents)
        closePopover()
    }

    const connect = () => {
        Backend.getDb()
            .doc(`users/${loggedUserId}`)
            .set({ apisConnected: { [projectId]: { calendar: true } } }, { merge: true })
            .then(loadEvents)
        closePopover()
        setIsSignedIn(GooleApi.checkAccessGranted())
        disableOtherProjects(projectId)
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
