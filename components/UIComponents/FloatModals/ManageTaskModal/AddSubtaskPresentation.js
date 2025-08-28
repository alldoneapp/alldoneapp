import React from 'react'
import { StyleSheet, TouchableOpacity, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export default function AddSubtaskPresentation({ toggleEditionMode, disabled }) {
    return (
        <TouchableOpacity
            style={localStyles.container}
            onPress={toggleEditionMode}
            disabled={disabled}
            onClick={e => {
                e.stopPropagation()
            }}
        >
            <Icon name="plus-square" size={24} color={colors.Primary100} />
            <Text style={localStyles.text}>Type to add new subtask</Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 9,
        paddingBottom: 7,
    },
    text: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 1,
        marginRight: 8,
        marginLeft: 12,
    },
})
