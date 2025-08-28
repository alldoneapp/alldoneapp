import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { progressMap } from '../GoalsView/GoalsHelper'

export default function SkillCompletionTag({ completion, style, onPress, disabled }) {
    const { progressTextColor } = progressMap[completion]
    const backgroundColor = completion === 100 ? colors.UtilityGreen125 : colors.UtilityBlue125
    return (
        <TouchableOpacity onPress={onPress} disabled={disabled}>
            <View style={[localStyles.container, style, { backgroundColor }]}>
                <Icon name={'bar-chart-2-Horizontal'} size={16} color={progressTextColor} style={localStyles.icon} />
                <Text style={[localStyles.text, windowTagStyle(), { color: progressTextColor }]}>{completion}%</Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
