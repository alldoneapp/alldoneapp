import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors } from '../styles/global'
import { CAPACITY_NONE, capacityDataMap } from './GoalsHelper'
import Avatar from '../Avatar'

export default function GoalAssigneeCapacityTag({ assignee, capacity, openModal, containerStyle, disabled }) {
    const { photoURL, uid } = assignee
    const { capacityValue } = capacityDataMap[capacity]
    return (
        <TouchableOpacity style={[localStyles.container, containerStyle]} onPress={openModal} disabled={disabled}>
            {capacity !== CAPACITY_NONE && <Text style={localStyles.capacity}>{capacityValue}</Text>}
            <Avatar avatarId={uid} reviewerPhotoURL={photoURL} size={20} borderSize={0} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        borderRadius: 12,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        marginRight: 8,
    },
    capacity: {
        ...styles.subtitle2,
        color: colors.Text03,
        paddingRight: 4,
        paddingLeft: 6,
    },
})
