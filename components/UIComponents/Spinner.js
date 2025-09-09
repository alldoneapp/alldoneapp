import React, { useEffect, useState } from 'react'
import { View, Animated, StyleSheet, Easing } from 'react-native'
import PropTypes from 'prop-types'
import Icon from '../Icon'
import { colors } from '../styles/global'

const Spinner = ({ containerSize, spinnerSize, containerColor, spinnerColor, containerStyle }) => {
    const animateValue = useState(new Animated.Value(0))[0]

    useEffect(() => {
        Animated.loop(
            Animated.timing(animateValue, {
                toValue: 1,
                duration: 1000,
                easing: Easing.linear,
                useNativeDriver: false,
            })
        ).start()
    }, [])

    const container = {
        width: containerSize,
        minWidth: containerSize,
        maxWidth: containerSize,
        height: containerSize,
        minHeight: containerSize,
        maxHeight: containerSize,
        backgroundColor: containerColor,
    }

    const spin = animateValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    })

    return (
        <View style={[localStyles.container, container, containerStyle]}>
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <Icon name={'spinner'} size={spinnerSize} color={spinnerColor} />
            </Animated.View>
        </View>
    )
}
export default Spinner

Spinner.propTypes = {
    containerSize: PropTypes.number,
    spinnerSize: PropTypes.number,
    containerColor: PropTypes.string,
    spinnerColor: PropTypes.string,
    containerStyle: PropTypes.oneOfType([PropTypes.object, PropTypes.array, PropTypes.number]),
}

Spinner.defaultProps = {
    containerSize: 24,
    spinnerSize: 16,
    containerColor: colors.Grey300,
    spinnerColor: colors.Primary100,
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 10000,
    },
})
