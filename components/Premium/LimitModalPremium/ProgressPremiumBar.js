import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'

export default function ProgressPremiumBar({ percent, headerText, barInnerText, containerStyle }) {
    return (
        <View style={containerStyle}>
            <Text style={localStyles.header}>{headerText}</Text>
            <View style={[localStyles.progressBar]}>
                <View style={[StyleSheet.absoluteFill, localStyles.progressFill, { width: `${percent}%` }]} />
                <Text style={localStyles.barText}>{barInnerText}</Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    progressFill: {
        backgroundColor: colors.UtilityYellow150,
        zIndex: -1,
        borderRadius: 12,
    },
    progressBar: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Yellow112,
        height: 24,
        borderRadius: 12,
        marginTop: 8,
        overflow: 'hidden',
    },
    header: {
        ...styles.body2,
        color: '#fff',
    },
    barText: {
        ...styles.subtitle1,
        color: colors.Yellow400,
    },
})
