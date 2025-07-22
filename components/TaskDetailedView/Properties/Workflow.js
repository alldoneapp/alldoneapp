import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import WorkflowPicker from './WorkflowPicker'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

const Workflow = ({ projectId, task, disabled }) => (
    <View style={localStyles.container}>
        <View style={{ marginRight: 8 }}>
            <Icon name="workflow" size={24} color={colors.Text03} />
        </View>
        <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Workflow')}</Text>
        <View style={{ marginLeft: 'auto' }}>
            <WorkflowPicker projectId={projectId} task={task} disabled={disabled} />
        </View>
    </View>
)
export default Workflow

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        flexDirection: 'row',
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
})
