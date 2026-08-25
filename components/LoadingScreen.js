import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Spinner from './UIComponents/Spinner'
import ConnectionStatusChip from './TopBar/ConnectionStatusChip'

const LoadingScreen = ({ text, secondText }) => {
    return (
        <View style={localstyles.container}>
            <Spinner containerSize={200} spinnerSize={150} />
            <Text style={[localstyles.text, { paddingTop: 40 }, !secondText && { marginBottom: 30 }]}>{text}</Text>
            {!!secondText && <Text style={[localstyles.text, { marginBottom: 30 }]}>{secondText}</Text>}
            <ConnectionStatusChip belowHeader />
        </View>
    )
}

const localstyles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'white',
        alignContent: 'center',
    },
    text: {
        fontFamily: 'Roboto-Regular',
        fontSize: 30,
        textAlign: 'center',
    },
})

export default LoadingScreen
