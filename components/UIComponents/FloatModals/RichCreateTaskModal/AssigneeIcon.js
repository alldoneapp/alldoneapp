import React from 'react'
import { Image, StyleSheet, View } from 'react-native'

import Icon from '../../../Icon'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import { getWorkstreamById, WORKSTREAM_ID_PREFIX } from '../../../Workstreams/WorkstreamHelper'

export default function AssigneeIcon({ projectId, userId }) {
    const ownerIsWorkstream = userId.startsWith(WORKSTREAM_ID_PREFIX)
    const user = ownerIsWorkstream ? getWorkstreamById(projectId, userId) : TasksHelper.getPeopleById(userId, projectId)

    const { photoURL } = user

    return (
        <View style={localStyles.container}>
            {ownerIsWorkstream ? (
                <Icon size={24} name="workstream" color={'#ffffff'} />
            ) : photoURL ? (
                <Image style={{ width: 24, height: 24 }} source={{ uri: photoURL }} />
            ) : (
                <SVGGenericUser width={24} height={24} svgid={`ci_p_rich_assignee_${projectId}`} />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 24,
        height: 24,
        borderRadius: 50,
        backgroundColor: 'transparent',
        overflow: 'hidden',
    },
})
