import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Icon from '../Icon'
import styles, { colors } from '../styles/global'

export default function AddEntry({ onPress }) {
    return (
        <TouchableOpacity style={localStyles.container} onPress={onPress}>
            <Icon name="plus-square" size={24} color={colors.Primary100}></Icon>
            <View style={{ marginLeft: 12 }}>
                <Text style={localStyles.text}>Type to add feed entry</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
    },
    text: {
        ...styles.body1,
        color: colors.Text03,
    },
})
