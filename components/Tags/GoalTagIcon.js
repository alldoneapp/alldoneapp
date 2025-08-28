import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import Icon from '../Icon'
import Colors from '../../Themes/Colors'
import { colors } from '../styles/global'

export default function GoalTagIcon({ onPress, disabled, highlightIcon }) {
    return (
        <TouchableOpacity style={localStyles.container} disabled={disabled} onPress={onPress}>
            <Icon name="target" size={20} color={highlightIcon ? colors.Text03 : colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        right: -1,
        top: 5,
        paddingVertical: 5,
    },
})
