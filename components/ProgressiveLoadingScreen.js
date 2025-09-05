import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Spinner from './UIComponents/Spinner'

const ProgressiveLoadingScreen = ({ step, totalSteps, currentMessage }) => {
    const progressPercentage = Math.round((step / totalSteps) * 100)

    return (
        <View style={localstyles.container}>
            <Spinner containerSize={200} spinnerSize={150} />
            <Text style={[localstyles.text, { paddingTop: 40 }]}>{currentMessage}</Text>
            <View style={localstyles.progressContainer}>
                <View style={localstyles.progressBar}>
                    <View style={[localstyles.progressFill, { width: `${progressPercentage}%` }]} />
                </View>
                <Text style={localstyles.progressText}>
                    {step}/{totalSteps} ({progressPercentage}%)
                </Text>
            </View>
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
        fontSize: 24,
        textAlign: 'center',
        marginBottom: 30,
    },
    progressContainer: {
        width: '80%',
        alignItems: 'center',
    },
    progressBar: {
        width: '100%',
        height: 6,
        backgroundColor: '#e0e0e0',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 10,
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#4CAF50',
        borderRadius: 3,
    },
    progressText: {
        fontFamily: 'Roboto-Regular',
        fontSize: 14,
        color: '#666',
    },
})

export default ProgressiveLoadingScreen
