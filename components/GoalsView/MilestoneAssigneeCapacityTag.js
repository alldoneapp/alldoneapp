import React from 'react'
import { StyleSheet, Text, TouchableOpacity, Image } from 'react-native'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export default function MilestoneAssigneeCapacityTag({ assignee, milestoneCapacity, openModal, disabled }) {
    const { photoURL } = assignee
    const capacityValue = `~${milestoneCapacity} ${translate(
        milestoneCapacity.toString() === '1' || milestoneCapacity.toString() === '-1' ? 'Day' : 'Days'
    )}`
    return (
        <TouchableOpacity style={localStyles.container} onPress={openModal} disabled={disabled}>
            <Image style={localStyles.avatar} source={{ uri: photoURL }} />
            <Text style={localStyles.date}>{capacityValue}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        borderRadius: 12,
        paddingLeft: 2,
        paddingRight: 8,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        marginRight: 8,
        marginBottom: 8,
    },
    avatar: {
        height: 20,
        width: 20,
        borderRadius: 100,
        marginRight: 4,
    },
    date: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
