import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { colors } from '../styles/global'
import Icon from '../Icon'
import GoogleMeet from '../GoogleCalendar/GoogleMeet'
import CurrentMeet from '../GoogleCalendar/CurrentMeet'
import UseCurrentMeet from '../GoogleCalendar/useCurrentMeet'
import { useDispatch, useSelector } from 'react-redux'
import { hideWebSideBar, updateRecordVideoModalData, updateScreenRecordingModalData } from '../../redux/actions'
import MyPlatform from '../MyPlatform'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../SidebarMenu/Themes'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { checkIsLimitedByTraffic } from '../Premium/PremiumHelper'

export default function MediaBar({ projectId, projectColor }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const showRecordVideoModalData = useSelector(state => state.recordVideoModalData.visible)
    const showScreenRecordingModalData = useSelector(state => state.screenRecordingModalData.visible)

    const { expanded } = useCollapsibleSidebar()
    const meetings = UseCurrentMeet(projectId)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectSectionList.MediaBar')

    const hideSideBar = () => {
        if (smallScreenNavigation) dispatch(hideWebSideBar())
    }

    const handleScreenRecording = () => {
        dispatch(updateScreenRecordingModalData(MyPlatform.isDesktop ? true : 'NotAvailable', projectId))
    }

    const disableRecordButtons = !!showScreenRecordingModalData || !!showRecordVideoModalData
    return (
        <>
            <View style={[localStyles.bar, !expanded && localStyles.barCollapsed, theme.bar(projectColor)]}>
                {expanded ? (
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            height: 48,
                        }}
                    >
                        <TouchableOpacity
                            style={{ marginRight: 14 }}
                            disabled={disableRecordButtons}
                            accessible={false}
                            onPress={() => {
                                if (!checkIsLimitedByTraffic(projectId))
                                    dispatch(updateRecordVideoModalData(true, projectId))
                                hideSideBar()
                            }}
                        >
                            <Icon name={'add-video'} size={18} color={theme.icon} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            disabled={disableRecordButtons}
                            accessible={false}
                            onPress={() => {
                                if (!checkIsLimitedByTraffic(projectId)) handleScreenRecording()
                                hideSideBar()
                            }}
                        >
                            <Icon name={'screen-recording'} size={18} color={theme.icon} />
                        </TouchableOpacity>
                        {false && <Text style={[localStyles.vLine, theme.vLine]}> </Text>}
                        {false && <GoogleMeet projectId={projectId} />}
                    </View>
                ) : (
                    <Icon size={18} name={'more-horizontal'} color={theme.icon} />
                )}
            </View>
            {expanded &&
                meetings &&
                meetings.map(item => <CurrentMeet key={item.objectId} meeting={item} projectId={projectId} />)}
        </>
    )
}

const localStyles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        //justifyContent: 'space-around',
        backgroundColor: colors.Secondary200,
        height: 48,
        paddingVertical: 8,
        paddingHorizontal: 26,
    },
    barCollapsed: {
        paddingHorizontal: 17,
    },
    vLine: {
        borderLeftWidth: 1,
        borderLeftColor: colors.Secondary100,
        marginHorizontal: 10,
        height: 16,
        width: 1,
        opacity: 0.3,
    },
})
