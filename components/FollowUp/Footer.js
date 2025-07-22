import React from 'react'
import { View, StyleSheet } from 'react-native'
import Button from '../UIControls/Button'

export default Footer = ({ text, onPress }) => (
    <View style={localStyles.doneButtonContainer}>
        <Button title={text} type={'primary'} onPress={onPress} />
    </View>
)

localStyles = StyleSheet.create({
    doneButtonContainer: {
        height: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
})
