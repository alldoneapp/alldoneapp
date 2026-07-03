import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import TaskPriorityWrapper from '../../UIComponents/FloatModals/TaskPriorityModal/TaskPriorityWrapper'

export default function Priority({ projectId, task, disabled }) {
    return (
        <View style={localStyles.container}>
            <View style={localStyles.icon}>
                <Icon name={'flag'} size={24} color={colors.Text03} />
            </View>
            <Text style={localStyles.text}>{translate('Priority')}</Text>
            <View style={localStyles.button}>
                <TaskPriorityWrapper projectId={projectId} task={task} disabled={disabled} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    button: {
        marginLeft: 'auto',
    },
})
