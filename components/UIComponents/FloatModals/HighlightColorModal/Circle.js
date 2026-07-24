import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export default function Circle({ color, selectedColor, inButton, icoForcedColor }) {
    return color === '#FFFFFF' ? (
        <Icon
            name={'droplet-off'}
            size={inButton ? 24 : 20}
            color={
                icoForcedColor
                    ? icoForcedColor
                    : inButton
                    ? colors.Text03
                    : color === selectedColor
                    ? colors.Primary100
                    : '#ffffff'
            }
        />
    ) : (
        <View
            style={[
                localStyles.circle,
                inButton && { width: 24, height: 24 },
                color === selectedColor && { borderColor: colors.Primary100 },
                { backgroundColor: color },
            ]}
        />
    )
}

const localStyles = StyleSheet.create({
    circle: {
        width: 20,
        height: 20,
        borderWidth: 2,
        borderRadius: 50,
        borderColor: '#ffffff',
        backgroundColor: '#ffffff',
    },
})
