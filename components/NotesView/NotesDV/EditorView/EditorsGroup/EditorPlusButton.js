import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'

import styles, { colors } from '../../../../styles/global'
import { MAX_EDITORS_TO_SHOW } from './EditorsConstants'

export default function EditorPlusButton({ editorsAmount, openModal }) {
    const plusAmount = editorsAmount - MAX_EDITORS_TO_SHOW
    return (
        <TouchableOpacity style={localStyles.button} onPress={openModal}>
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{`+${plusAmount}`}</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        width: 30,
        height: 30,
        borderRadius: 100,
        borderWidth: 2,
        borderColor: '#007FFF',
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
