import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'

import ApiCalendar from '../../apis/google/calendar/apiCalendar'
import { hideWebSideBar, updateGoogleMeetModalData } from '../../redux/actions'
import global from '../styles/global'
import Icon from '../Icon'
import Shortcut from '../UIControls/Shortcut'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../SidebarMenu/Themes'

export default function GoogleMeet({ projectId }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const showShortcuts = useSelector(state => state.showShortcuts)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const showGoogleMeetModalData = useSelector(state => state.googleMeetModalData.visible)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.MediaBar')

    const tryToOpenModal = () => {
        ApiCalendar.requestConsent(openModal)
    }

    const openModal = async () => {
        dispatch(updateGoogleMeetModalData(true, projectId, loggedUserId))
    }

    const hideSideBar = () => {
        if (smallScreenNavigation) dispatch(hideWebSideBar())
    }

    return (
        <Hotkeys
            keyName={'alt+M'}
            filter={e => true}
            onKeyDown={() => {
                tryToOpenModal()
                hideSideBar()
            }}
        >
            <TouchableOpacity
                disabled={showGoogleMeetModalData}
                accessible={false}
                onPress={() => {
                    tryToOpenModal()
                    hideSideBar()
                }}
            >
                <View style={{ flexDirection: 'row' }}>
                    <Icon name={'video-meeting'} size={18} color={theme.icon} />
                    <Text style={[global.caption1, { marginLeft: 12, color: theme.icon }]}>Google Meet</Text>
                </View>
                {showShortcuts && (
                    <View style={localStyles.shortcut}>
                        <Shortcut text={'M'} />
                    </View>
                )}
            </TouchableOpacity>
        </Hotkeys>
    )
}

const localStyles = StyleSheet.create({
    shortcut: {
        position: 'absolute',
        top: -8,
        right: -15,
    },
})
