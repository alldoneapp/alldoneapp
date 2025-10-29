import React, { useState } from 'react'
import { Animated, StyleSheet, Easing, TouchableOpacity } from 'react-native'
import Icon from '../Icon'
import { colors } from '../styles/global'
import { useSelector } from 'react-redux'

const ReloadCalendar = ({ projectId, Promise }) => {
    const animateValue = useState(new Animated.Value(0))[0]

    const loadEvents = () => {
        console.log('[ReloadCalendar] Button clicked, projectId:', projectId)
        startSpinning()
        Promise(projectId)
            .then(result => {
                console.log('[ReloadCalendar] Sync completed successfully', result)
                stopSpinning()
            })
            .catch(error => {
                console.error('[ReloadCalendar] Sync failed with error:', error)
                stopSpinning()
            })
    }

    const startSpinning = () => {
        Animated.loop(
            Animated.timing(animateValue, {
                toValue: 1,
                duration: 1000,
                easing: Easing.linear, // Easing is an additional import from react-native
                useNativeDriver: false, // To make use of native driver for performance
            })
        ).start()
    }

    const stopSpinning = () => {
        Animated.timing(animateValue, {
            toValue: 0,
            duration: 0,
            easing: Easing.linear, // Easing is an additional import from react-native
            useNativeDriver: true, // To make use of native driver for performance
        }).start()
    }

    const spin = animateValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    })

    return (
        <TouchableOpacity style={[localStyles.container]} onPress={loadEvents}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <Icon name={'refresh-cw'} size={20} color={colors.Text03} />
            </Animated.View>
        </TouchableOpacity>
    )
}
export default ReloadCalendar

const localStyles = StyleSheet.create({
    container: {
        marginLeft: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
})
