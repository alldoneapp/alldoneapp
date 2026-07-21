import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { resolveAssistantTemplateConflicts } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

const FIELD_LABEL_KEYS = {
    displayName: 'Name',
    description: 'Description',
    emailSignature: 'Email signature',
    heartbeatModel: 'Heartbeat model',
    model: 'Assistant model',
    temperature: 'Temperature',
}

const MODEL_LABELS = {
    MODEL_GPT5_6_SOL: 'GPT 5.6 Sol',
    MODEL_GPT5_6_TERRA: 'GPT 5.6 Terra',
    MODEL_GPT5_6_LUNA: 'GPT 5.6 Luna',
}

export const formatTemplateConflictField = field => {
    const labelKey = FIELD_LABEL_KEYS[field]
    if (labelKey) return translate(labelKey)

    const readable = String(field || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : ''
}

export const formatTemplateConflictValue = (field, value, exists) => {
    if (!exists) return translate('(removed)')
    if (field === 'model' || field === 'heartbeatModel') return MODEL_LABELS[value] || value
    if (typeof value === 'string') return value || translate('(empty)')
    try {
        return JSON.stringify(value, null, 2)
    } catch (error) {
        return String(value)
    }
}

export default function UpdateFromTemplate({ projectId, assistant, disabled }) {
    const [updatingField, setUpdatingField] = useState('')
    if (!assistant?.copiedFromTemplateAssistantId) return null

    const conflicts = Array.isArray(assistant.templateSyncConflicts) ? assistant.templateSyncConflicts : []
    const resolve = async (field, acceptTemplate) => {
        setUpdatingField(field)
        try {
            await resolveAssistantTemplateConflicts(projectId, assistant.uid, acceptTemplate ? [field] : [], [field])
        } finally {
            setUpdatingField('')
        }
    }
    const syncedLabel = assistant.templateSyncedAt
        ? `${translate('Synced from template')} • ${new Date(assistant.templateSyncedAt).toLocaleString()}`
        : translate('Linked to template • waiting for the next template update')

    return (
        <View style={[localStyles.container, conflicts.length ? localStyles.needsReview : null]}>
            <View style={localStyles.statusRow}>
                <View style={localStyles.statusCopy}>
                    {!!conflicts.length && (
                        <Text style={localStyles.reviewCount}>
                            {conflicts.length}{' '}
                            {translate(
                                conflicts.length === 1 ? 'template change needs review' : 'template changes need review'
                            )}
                        </Text>
                    )}
                    <Text style={localStyles.status}>{syncedLabel}</Text>
                </View>
            </View>
            {conflicts.map(conflict => (
                <View key={conflict.field} style={localStyles.conflict}>
                    <Text style={localStyles.field}>{formatTemplateConflictField(conflict.field)}</Text>
                    <Text style={localStyles.conflictHelp}>
                        {translate('Choose which version to use for this setting.')}
                    </Text>
                    <View style={localStyles.diffRow}>
                        <View style={[localStyles.valueColumn, localStyles.localColumn]}>
                            <Text style={localStyles.columnTitle}>{translate('Your version')}</Text>
                            <Text selectable style={localStyles.value}>
                                {formatTemplateConflictValue(
                                    conflict.field,
                                    conflict.localValue,
                                    conflict.localValueExists
                                )}
                            </Text>
                        </View>
                        <View style={[localStyles.valueColumn, localStyles.templateColumn]}>
                            <Text style={localStyles.columnTitle}>{translate('Template version')}</Text>
                            <Text selectable style={localStyles.value}>
                                {formatTemplateConflictValue(
                                    conflict.field,
                                    conflict.templateValue,
                                    conflict.templateValueExists
                                )}
                            </Text>
                        </View>
                    </View>
                    <View style={localStyles.actions}>
                        <View style={localStyles.actionButton}>
                            <Button
                                type="ghost"
                                title={translate('Keep mine')}
                                disabled={disabled || !!updatingField}
                                onPress={() => resolve(conflict.field, false)}
                            />
                        </View>
                        <View style={localStyles.actionButton}>
                            <Button
                                type="primary"
                                title={translate('Accept template')}
                                disabled={disabled || !!updatingField}
                                onPress={() => resolve(conflict.field, true)}
                            />
                        </View>
                    </View>
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Grey100,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey300,
        padding: 16,
        marginBottom: 20,
    },
    needsReview: {
        backgroundColor: colors.UtilityYellow100,
        borderColor: colors.UtilityYellow150,
    },
    statusRow: { flexDirection: 'row', alignItems: 'center' },
    statusCopy: { flex: 1, minWidth: 220 },
    status: { ...styles.caption1, color: colors.Text02, marginTop: 2 },
    reviewCount: { ...styles.subtitle2, color: colors.UtilityYellow300 },
    conflict: {
        backgroundColor: '#ffffff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey300,
        marginTop: 16,
        padding: 16,
    },
    field: { ...styles.subtitle1, color: colors.Text01 },
    conflictHelp: { ...styles.caption1, color: colors.Text02, marginTop: 4 },
    diffRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
        marginTop: 12,
    },
    valueColumn: {
        flexGrow: 1,
        flexBasis: 260,
        minWidth: 220,
        minHeight: 88,
        borderRadius: 6,
        borderWidth: 1,
        borderLeftWidth: 4,
        padding: 12,
        margin: 4,
    },
    localColumn: {
        backgroundColor: colors.Grey100,
        borderColor: colors.Grey300,
        borderLeftColor: colors.Secondary100,
    },
    templateColumn: {
        backgroundColor: colors.UtilityGreen100,
        borderColor: colors.UtilityGreen125,
        borderLeftColor: colors.UtilityGreen300,
    },
    columnTitle: { ...styles.caption1, color: colors.Text02, marginBottom: 8 },
    value: { ...styles.body1, color: colors.Text01, flexShrink: 1 },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        marginHorizontal: -4,
        marginTop: 8,
    },
    actionButton: { marginHorizontal: 4, marginTop: 8 },
})
