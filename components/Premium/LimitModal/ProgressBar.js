import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'

export default function ProgressBar({ percent, containerStyle, headerText, headerTextStyle }) {
    return (
        <View style={containerStyle}>
            <Text style={[localStyles.header, headerTextStyle]}>{headerText}</Text>
            <View style={[localStyles.progressBar]}>
                <View style={[StyleSheet.absoluteFill, localStyles.progressFill, { width: `${percent}%` }]} />
                <Text style={localStyles.barText}>{percent}%</Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    progressFill: {
        backgroundColor: colors.UtilityBlue150,
        zIndex: -1,
        borderRadius: 12,
    },
    progressBar: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.UtilityBlue112,
        height: 24,
        borderRadius: 12,
        marginTop: 8,
        overflow: 'hidden',
    },
    header: {
        ...styles.body2,
    },
    barText: {
        ...styles.subtitle1,
        color: colors.Primary400,
    },
})
