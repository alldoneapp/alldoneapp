import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import { DEFAULT_WORKSTREAM_ID, getWorkstreamInProject } from '../Workstreams/WorkstreamHelper'
import Avatar from '../Avatar'

export default function GoalsUserGroupHeader({ navigateToSection, userId, projectId }) {
    const user = TasksHelper.getPeopleById(userId, projectId) || getWorkstreamInProject(projectId, userId)
    const { recorderUserId, photoURL, displayName } = user

    const isContact = !!recorderUserId
    const text = `${translate('Goals assigned to')} ${
        userId === DEFAULT_WORKSTREAM_ID ? translate(displayName) : displayName
    }`

    return (
        <View style={localStyles.container}>
            <TouchableOpacity
                onPress={navigateToSection}
                style={localStyles.centeredRow}
                disabled={isContact}
                accessible={false}
            >
                <Avatar avatarId={userId} reviewerPhotoURL={photoURL} borderSize={0} />
                <Text style={localStyles.text} numberOfLines={1}>
                    {text}
                </Text>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        marginTop: 52,
        paddingBottom: 2,
        paddingLeft: 2,
    },
    centeredRow: {
        flex: 1,
        maxHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
    },
    text: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 8,
    },
})
