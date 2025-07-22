import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

const WorkflowHeader = ({ stepsAmount }) => (
    <View style={localStyles.container}>
        <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Estimations')}</Text>
        <Text style={[styles.caption2, localStyles.steps]}>{parseText(stepsAmount)}</Text>
    </View>
)

export default WorkflowHeader

const parseText = number => {
    if (number === 0) {
        return translate('No steps yet')
    } else if (number > 1) {
        return translate('Amount steps', { amount: number })
    }
    return translate('Amount step', { amount: number })
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
