import React from 'react'
import { Text, TouchableOpacity, StyleSheet } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'

export default function DoneStateButton({ onPress, text, checked, disabled = false }) {
    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress} disabled={disabled}>
            <Icon name={checked ? 'square-checked-gray' : 'square'} size={16} color={colors.Text03} />
            <Text style={localStyles.text}>{text}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        height: 30,
        paddingLeft: 4,
        paddingRight: 8,
        borderColor: colors.Text03,
        borderWidth: 1,
        borderRadius: 4,
        alignItems: 'center',
        alignSelf: 'flex-start',
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 6,
    },
})
