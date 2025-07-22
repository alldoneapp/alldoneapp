import React from 'react'
import { StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'

import Icon from '../Icon'

export default function AddButton({ successAction, onPress, style, disabled }) {
    const test = 'testingTheReplaceScript'
    return (
        <TouchableOpacity
            style={[localStyles.container, style]}
            onPress={onPress}
            accessible={false}
            disabled={disabled}
        >
            <Icon name={successAction ? 'plus' : 'x'} size={24} color={'#ffffff'} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 40,
        paddingHorizontal: 8,
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
