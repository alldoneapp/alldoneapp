import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'

import styles, { colors } from '../../../../styles/global'
import Icon from '../../../../Icon'

export default function EmailTag({ value, onPress, disabled }) {
    console.log('EmailTag rendering with value:', value)
    return (
        <TouchableOpacity onPress={onPress} style={localStyles.tag} disabled={disabled}>
            <Icon name={'mail'} size={16} color={colors.Yellow300} />
            <Text style={localStyles.text} numberOfLines={1}>
                {value}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        ...styles.subtitle2,
        display: 'inline-flex',
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Yellow125,
        borderRadius: 50,
        fontSize: 18,
        paddingLeft: 4,
        paddingRight: 8,
        height: 24,
        maxWidth: '100%',
    },
    text: {
        fontFamily: 'Roboto-Medium',
        fontSize: 14,
        color: colors.Yellow300,
        marginTop: 1,
        marginLeft: 4,
    },
})
