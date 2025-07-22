import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../styles/global'
import { DYNAMIC_PERCENT } from './GoalsHelper'

export default function GoalProgressBar({ progress, barColor, dynamicProgress }) {
    return (
        <View
            style={[
                localStyles.container,
                {
                    width: progress
                        ? progress === DYNAMIC_PERCENT
                            ? dynamicProgress
                                ? `${dynamicProgress}%`
                                : 61
                            : `${progress}%`
                        : 61,
                    backgroundColor: barColor,
                },
            ]}
        />
    )
}

const localStyles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 0,
        top: 0,
        minHeight: 40,
        height: '100%',
        borderRadius: 4,
        backgroundColor: colors.Grey300,
    },
})
