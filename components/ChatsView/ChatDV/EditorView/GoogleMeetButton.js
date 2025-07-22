import React from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { View } from 'react-native'

import ApiCalendar from '../../../../apis/google/calendar/apiCalendar'
import Button from '../../../UIControls/Button'
import { updateChatGoogleMeetModalData } from '../../../../redux/actions'

export default function GoogleMeetButton({ title = '', members, projectId }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)

    const tryToOpenModal = () => {
        ApiCalendar.requestConsent(openModal)
    }

    const openModal = async () => {
        dispatch(
            updateChatGoogleMeetModalData(
                true,
                projectId,
                loggedUserId,
                members ? members.filter(m => m !== loggedUserId) : [],
                title
            )
        )
    }

    return (
        <View style={{ flexDirection: 'row' }}>
            <Button
                noBorder={true}
                type="ghost"
                icon="video-meeting"
                onPress={tryToOpenModal}
                buttonStyle={{ marginRight: 4 }}
            />
        </View>
    )
}
