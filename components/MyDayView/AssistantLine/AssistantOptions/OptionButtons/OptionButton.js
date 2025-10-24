import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../../../../styles/global'
import Icon from '../../../../Icon'

export default function OptionButton({ containerStyle, text, icon, onPress, disabled = false }) {
    console.log('[ButtonDebug] OptionButton render:', { text, disabled, willApplyDisabledStyle: !!disabled })

    return (
        <TouchableOpacity
            style={[localStyles.tag, disabled && localStyles.disabled, containerStyle]}
            onPress={disabled ? undefined : onPress}
            disabled={disabled}
        >
            <View style={localStyles.icon}>
                <Icon name={icon} size={16} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{text}</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        flexDirection: 'row',
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        height: 24,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: colors.Text03,
        paddingHorizontal: 4,
    },
    text: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 4,
    },
    icon: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
    disabled: {
        opacity: 0.3,
    },
})
