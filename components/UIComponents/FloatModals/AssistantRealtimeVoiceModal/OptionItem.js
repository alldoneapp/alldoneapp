import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import styles from '../../../styles/global'

export default function OptionItem({ voice, selectedVoice, selectVoice }) {
    const label = voice.charAt(0).toUpperCase() + voice.slice(1)
    return (
        <TouchableOpacity style={localStyles.container} onPress={() => selectVoice(voice)}>
            <Text style={localStyles.text}>{label}</Text>
            <View>{selectedVoice === voice && <Icon name="check" size={24} color="#fff" />}</View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 40,
        paddingVertical: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    text: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
})
