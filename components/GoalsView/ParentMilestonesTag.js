import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'

export default function ParentMilestonesTag({ onPress, parentMilestonesData, style, disabled = false }) {
    const { milestonesAmount, milestonePosition } = parentMilestonesData
    const text = `${milestonePosition}/${milestonesAmount}`
    return (
        <TouchableOpacity style={[localStyles.container, style]} onPress={onPress} disabled={disabled}>
            <Icon name="milestone-2" size={16} color={colors.Text03} />
            <Text style={localStyles.text}>{text}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 24,
        borderRadius: 12,
        paddingLeft: 4,
        paddingRight: 8,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        marginLeft: 8,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        marginLeft: 6,
    },
})
