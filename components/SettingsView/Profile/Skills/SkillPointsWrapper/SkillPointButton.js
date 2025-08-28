import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../../styles/global'

export default function SkillPointButton({ points, containerStyle, disabled, onPress }) {
    return (
        <TouchableOpacity style={[localStyles.container, containerStyle]} onPress={onPress} disabled={disabled}>
            <Text style={localStyles.text}>{points}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 3,
        marginRight: 4,
        height: 32,
        width: 52,
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderColor: colors.UtilityBlue150,
    },
    text: {
        ...styles.subtitle1,
        color: colors.UtilityBlue300,
    },
})
