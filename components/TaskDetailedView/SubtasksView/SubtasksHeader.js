import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function SubtasksHeader({ subtaskAmount }) {
    return (
        <View style={localStyles.container}>
            <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Subtasks')}</Text>
            <Text style={[styles.caption2, localStyles.steps]}>{parseText(subtaskAmount)}</Text>
        </View>
    )
}

const parseText = number => {
    if (number === 0) {
        return translate('No items yet')
    } else if (number > 1) {
        return translate('Amount items', { amount: number })
    }
    return translate('Amount item', { amount: number })
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    steps: {
        color: colors.Text02,
        marginLeft: 16,
        height: 20,
    },
})
