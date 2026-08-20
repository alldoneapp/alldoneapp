import React from 'react'
import { StyleSheet } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'

import { colors } from '../../styles/global'
import Icon from '../../Icon'

export default function ShowMoreButton({ forExpand, onPress, style }) {
    return (
        <TouchableOpacity style={[localStyles.button, { marginBottom: forExpand ? 16 : 0 }, style]} onPress={onPress}>
            <Icon name={forExpand ? 'chevron-down' : 'chevron-up'} size={24} color={colors.Text04} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center',
        padding: 8,
        height: 40,
    },
})
