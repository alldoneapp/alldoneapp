import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

const WorkflowHeader = ({ stepsAmount }) => (
    <View style={localStyles.container}>
        <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Workflow')}</Text>
        <View style={{ marginLeft: 16, height: 28, justifyContent: 'flex-end' }}>
            <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseText(stepsAmount)}</Text>
        </View>
    </View>
)
export default WorkflowHeader

function parseText(number) {
    if (number === 0) {
        return translate('No steps yet')
    } else if (number > 1) {
        return translate('Amount steps', { amount: number })
    }
    return translate('Amount step', { amount: number })
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        height: 72,
        paddingTop: 32,
        paddingBottom: 12,
        width: '100%',
        alignItems: 'center',
    },
})
