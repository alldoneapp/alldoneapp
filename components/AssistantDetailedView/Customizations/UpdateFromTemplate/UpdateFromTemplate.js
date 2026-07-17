import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Button from '../../../UIControls/Button'
import styles, { colors } from '../../../styles/global'
import { resolveAssistantTemplateConflicts } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { translate } from '../../../../i18n/TranslationService'

const formatValue = (value, exists) => {
    if (!exists) return translate('(removed)')
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
                <Text style={localStyles.status}>{syncedLabel}</Text>
                {!!conflicts.length && (
                    <Text style={localStyles.reviewCount}>
                        {conflicts.length}{' '}
                        {translate(
                            conflicts.length === 1 ? 'template change needs review' : 'template changes need review'
                        )}
                    </Text>
                )}
            </View>
            {conflicts.map(conflict => (
                <View key={conflict.field} style={localStyles.conflict}>
                    <Text style={localStyles.field}>{conflict.field}</Text>
                    <View style={localStyles.diffRow}>
                        <View style={[localStyles.valueColumn, localStyles.localColumn]}>
                            <Text style={localStyles.columnTitle}>{translate('Your version')}</Text>
                            <Text selectable style={localStyles.value}>
                                {formatValue(conflict.localValue, conflict.localValueExists)}
                            </Text>
                        </View>
                        <View style={[localStyles.valueColumn, localStyles.templateColumn]}>
                            <Text style={localStyles.columnTitle}>{translate('Template version')}</Text>
                            <Text selectable style={localStyles.value}>
                                {formatValue(conflict.templateValue, conflict.templateValueExists)}
                            </Text>
                        </View>
                    </View>
                    <View style={localStyles.actions}>
                        <Button
                            type="ghost"
                            title={translate('Keep mine')}
                            disabled={disabled || !!updatingField}
                            onPress={() => resolve(conflict.field, false)}
                        />
                        <Button
                            type="primary"
                            title={translate('Accept template')}
                            disabled={disabled || !!updatingField}
                            onPress={() => resolve(conflict.field, true)}
                        />
                    </View>
                </View>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Secondary200,
        padding: 12,
        marginBottom: 20,
    },
    needsReview: { borderColor: colors.UtilityYellow200 || '#d6a84b' },
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    status: { ...styles.caption1, color: colors.Text03 },
    reviewCount: { ...styles.caption1, color: colors.UtilityYellow200 || '#d6a84b' },
    conflict: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.Secondary200, paddingTop: 12 },
    field: { ...styles.subtitle2, color: colors.Text01, marginBottom: 8 },
    diffRow: { flexDirection: 'row' },
    valueColumn: { flex: 1, padding: 10, minHeight: 72 },
    localColumn: { backgroundColor: 'rgba(255, 93, 93, 0.10)', marginRight: 4 },
    templateColumn: { backgroundColor: 'rgba(76, 175, 80, 0.10)', marginLeft: 4 },
    columnTitle: { ...styles.caption1, color: colors.Text03, marginBottom: 6 },
    value: { ...styles.body2, color: colors.Text01, fontFamily: 'monospace' },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
})
