import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import styles, { colors } from '../styles/global'
import Icon from '../Icon'

const CounterTag = ({ icon, counter = 0, style, onPress, disabled }) => {
    return (
        <TouchableOpacity style={[localStyles.container, style]} onPress={onPress} disabled={disabled || !onPress}>
            {icon && <Icon name={icon} size={16} color={colors.Text03} style={localStyles.icon} />}
            <Text style={localStyles.text}>{counter}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
        paddingHorizontal: 4,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginTop: 2,
        marginRight: 4,
        marginLeft: 2,
    },
})

export default CounterTag
