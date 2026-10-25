import React from 'react'
import { View, StyleSheet, Text, Image } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import NewFeedDot from '../FollowSwitchableTag/NewFeedDot'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { getTimeFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'

// `icon` stands in for the avatar of a change nobody in the project made (the wiki's own updates).
export default function FeedsTypesLeftHeader({ projectId, showNewFeedDot, feedActiveTab, feed, projectColor, icon }) {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const { lastChangeDate, creatorId } = feed

    const creationTime = moment(lastChangeDate).format(getTimeFormat())
    const { photoURL } = getUserPresentationDataInProject(projectId, creatorId)
    return (
        <View style={[localStyles.container]}>
            {showNewFeedDot && <NewFeedDot feedActiveTab={feedActiveTab} isMiddleScreen={isMiddleScreen} />}
            <Text style={localStyles.time}>{creationTime}</Text>
            {icon ? (
                <View style={localStyles.projectColorContainer}>
                    <Icon name={icon} size={16} color={colors.Text03} />
                </View>
            ) : projectColor ? (
                <View style={localStyles.projectColorContainer}>
                    <View style={[localStyles.projectColorBall, { backgroundColor: projectColor }]} />
                </View>
            ) : (
                <Image style={localStyles.avatar} source={{ uri: photoURL }} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 20,
        marginTop: 2,
    },
    time: {
        ...styles.body3,
    },
    avatar: {
        borderRadius: 100,
        height: 20,
        width: 20,
        marginLeft: 8,
    },
    projectColorContainer: {
        height: 20,
        width: 20,
        marginLeft: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    projectColorBall: {
        borderRadius: 100,
        width: 13.33,
        height: 13.33,
    },
})
