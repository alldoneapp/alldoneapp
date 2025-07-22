import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

import styles, { colors } from '../styles/global'

export default function UsersPlusButton({ usersAmount, openModal, disabled, containerStyle, maxUsersToShow }) {
    const plusAmount = usersAmount - maxUsersToShow
    return (
        <TouchableOpacity
            style={[localStyles.button, containerStyle]}
            onPress={openModal}
            disabled={disabled}
            accessible={false}
        >
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{`+${plusAmount}`}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        width: 32,
        height: 32,
        borderRadius: 100,
        backgroundColor: colors.Grey300,
        marginLeft: -12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    textContainer: {
        alignItems: 'center',
        flex: 1,
    },
    text: {
        ...styles.caption1,
        color: colors.Text02,
    },
})
