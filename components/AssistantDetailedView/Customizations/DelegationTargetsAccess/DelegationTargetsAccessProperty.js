import React, { useMemo } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import DelegationTargetsAccessWrapper from './DelegationTargetsAccessWrapper'

const buildDelegationTargetKey = (projectId, assistantId) => `${projectId}:${assistantId}`

const getDelegationDescription = target => {
    return (
        (typeof target?.delegationToolDescriptionManual === 'string' &&
            target.delegationToolDescriptionManual.trim()) ||
        (typeof target?.delegationToolDescriptionGenerated === 'string' &&
            target.delegationToolDescriptionGenerated.trim()) ||
        (typeof target?.description === 'string' && target.description.trim()) ||
        ''
    )
}

export default function DelegationTargetsAccessProperty({ disabled, projectId, assistant }) {
    const projectAssistants = useSelector(state => state.projectAssistants?.[projectId] || [])

    const availableTargets = useMemo(() => {
        return projectAssistants
            .filter(target => target?.uid && target.uid !== assistant.uid)
            .map(target => ({
                uid: target.uid,
                displayName: target.displayName || 'Assistant',
                description: getDelegationDescription(target),
                targetKey: buildDelegationTargetKey(projectId, target.uid),
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
    }, [assistant.uid, projectAssistants, projectId])

    const hasSelection = Array.isArray(assistant.allowedDelegationTargetKeys)
    const rawSelectedKeys = hasSelection ? assistant.allowedDelegationTargetKeys : []
    const selectedKeys = new Set(rawSelectedKeys.map(key => String(key || '').trim()).filter(Boolean))

    const selectedTargets = hasSelection
        ? availableTargets.filter(target => selectedKeys.has(target.targetKey) || selectedKeys.has(target.uid))
        : availableTargets

    const summaryText = !availableTargets.length
        ? translate('No assistants available for delegation')
        : !hasSelection
        ? translate('All assistants enabled for delegation')
        : !selectedTargets.length
        ? translate('No assistants enabled for delegation')
        : selectedTargets.map(target => target.displayName).join(', ')

    const selectionCount = hasSelection ? selectedTargets.length : availableTargets.length

    return (
        <View style={localStyles.container}>
            <Icon name="tool" size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{translate('Delegation targets')}</Text>
                <Text style={localStyles.summary} numberOfLines={1}>
                    {summaryText}
                </Text>
            </View>
            <View style={{ marginLeft: 'auto' }}>
                <DelegationTargetsAccessWrapper
                    disabled={disabled}
                    projectId={projectId}
                    assistant={assistant}
                    availableTargets={availableTargets}
                    selectionCount={selectionCount}
                />
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
    textContainer: {
        flexShrink: 1,
        flexGrow: 1,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    summary: {
        ...styles.caption2,
        color: colors.Text04,
    },
})
