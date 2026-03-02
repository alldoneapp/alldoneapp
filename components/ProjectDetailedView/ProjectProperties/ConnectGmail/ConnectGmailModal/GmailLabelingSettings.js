import React, { useEffect, useState } from 'react'
import { Dimensions, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import Button from '../../../../UIControls/Button'
import Switch from '../../../../UIControls/Switch'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import {
    getGmailLabelingConfig,
    runGmailLabelingSync,
    saveGmailLabelingConfig,
} from '../../../../../utils/backends/Gmail/gmailLabelingFirestore'

function createEmptyLabel(index = 0) {
    return {
        key: '',
        gmailLabelName: '',
        description: '',
        autoArchive: false,
        id: `label-${Date.now()}-${index}`,
    }
}

function normalizeConfig(projectId, config = {}, gmailEmail = '') {
    const labelDefinitions = Array.isArray(config.labelDefinitions)
        ? config.labelDefinitions.map((label, index) => ({
              ...createEmptyLabel(index),
              ...label,
          }))
        : [createEmptyLabel(0), createEmptyLabel(1)]

    return {
        enabled: typeof config.enabled === 'boolean' ? config.enabled : true,
        projectId,
        gmailEmail: config.gmailEmail || gmailEmail || '',
        prompt: config.prompt || '',
        model: config.model || 'MODEL_GPT5_2',
        processUnreadOnly: typeof config.processUnreadOnly === 'boolean' ? config.processUnreadOnly : true,
        onlyInbox: typeof config.onlyInbox === 'boolean' ? config.onlyInbox : true,
        maxMessagesPerRun: Number.isFinite(config.maxMessagesPerRun) ? String(config.maxMessagesPerRun) : '20',
        confidenceThreshold: Number.isFinite(config.confidenceThreshold) ? String(config.confidenceThreshold) : '0.7',
        labelDefinitions,
    }
}

function sanitizeConfigForSave(config) {
    const parsedMaxMessages = parseInt(config.maxMessagesPerRun, 10)
    const parsedConfidenceThreshold = parseFloat(config.confidenceThreshold)

    return {
        enabled: !!config.enabled,
        gmailEmail: config.gmailEmail || '',
        prompt: config.prompt || '',
        model: config.model || 'MODEL_GPT5_2',
        processUnreadOnly: !!config.processUnreadOnly,
        onlyInbox: !!config.onlyInbox,
        maxMessagesPerRun: Number.isFinite(parsedMaxMessages) ? parsedMaxMessages : 20,
        confidenceThreshold: Number.isFinite(parsedConfidenceThreshold) ? parsedConfidenceThreshold : 0.7,
        labelDefinitions: (config.labelDefinitions || []).map(({ id, ...label }) => ({
            ...label,
            autoArchive: !!label.autoArchive,
        })),
    }
}

function SyncSummary({ state, result }) {
    const lastError = result?.lastError || state?.lastError
    const lastLabeledCount =
        typeof result?.labeled === 'number'
            ? result.labeled
            : typeof state?.lastLabeledCount === 'number'
            ? state.lastLabeledCount
            : 0
    const lastArchivedCount =
        typeof result?.archived === 'number'
            ? result.archived
            : typeof state?.lastArchivedCount === 'number'
            ? state.lastArchivedCount
            : 0
    const lastProcessedCount =
        typeof result?.scanned === 'number'
            ? result.scanned
            : typeof state?.lastProcessedCount === 'number'
            ? state.lastProcessedCount
            : 0

    return (
        <View style={localStyles.summaryCard}>
            <Text style={localStyles.sectionTitle}>{translate('Gmail sync status')}</Text>
            <Text style={localStyles.summaryText}>
                {translate('Gmail sync scanned', { count: lastProcessedCount })}
            </Text>
            <Text style={localStyles.summaryText}>{translate('Gmail sync labeled', { count: lastLabeledCount })}</Text>
            <Text style={localStyles.summaryText}>
                {translate('Gmail sync archived', { count: lastArchivedCount })}
            </Text>
            {state?.status ? (
                <Text style={localStyles.summaryText}>{translate('Gmail sync state', { state: state.status })}</Text>
            ) : null}
            {lastError ? <Text style={localStyles.errorText}>{lastError}</Text> : null}
        </View>
    )
}

export default function GmailLabelingSettings({ projectId, isConnected, authStatus }) {
    const { height: windowHeight } = Dimensions.get('window')
    const [config, setConfig] = useState(() => normalizeConfig(projectId))
    const [syncState, setSyncState] = useState(null)
    const [syncResult, setSyncResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [error, setError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')

    const connectedEmail = authStatus?.email || config.gmailEmail || ''
    const needsReconnect = isConnected && authStatus?.hasCredentials && authStatus?.hasModifyScope === false
    const canManage = isConnected && authStatus?.hasCredentials && authStatus?.hasModifyScope !== false
    const scrollMaxHeight = Math.max(Math.min(windowHeight - 260, 560), 260)

    useEffect(() => {
        let isMounted = true

        const loadConfig = async () => {
            if (!isConnected || !authStatus?.hasCredentials) return

            setLoading(true)
            setError('')
            try {
                const result = await getGmailLabelingConfig(projectId)
                if (!isMounted) return

                setConfig(normalizeConfig(projectId, result?.config || {}, connectedEmail))
                setSyncState(result?.state || null)
            } catch (loadError) {
                if (!isMounted) return
                setError(loadError.message || translate('Failed to load Gmail labeling settings.'))
            } finally {
                if (isMounted) setLoading(false)
            }
        }

        loadConfig()

        return () => {
            isMounted = false
        }
    }, [projectId, isConnected, authStatus?.hasCredentials, authStatus?.hasModifyScope, connectedEmail])

    const updateConfig = patch => {
        setConfig(currentConfig => ({
            ...currentConfig,
            ...patch,
        }))
    }

    const updateLabel = (index, patch) => {
        setConfig(currentConfig => {
            const nextLabels = [...currentConfig.labelDefinitions]
            nextLabels[index] = {
                ...nextLabels[index],
                ...patch,
            }
            return {
                ...currentConfig,
                labelDefinitions: nextLabels,
            }
        })
    }

    const addLabel = () => {
        setConfig(currentConfig => ({
            ...currentConfig,
            labelDefinitions: [
                ...currentConfig.labelDefinitions,
                createEmptyLabel(currentConfig.labelDefinitions.length),
            ],
        }))
    }

    const removeLabel = index => {
        setConfig(currentConfig => ({
            ...currentConfig,
            labelDefinitions: currentConfig.labelDefinitions.filter((_, currentIndex) => currentIndex !== index),
        }))
    }

    const onSave = async () => {
        setSaving(true)
        setError('')
        setSuccessMessage('')

        try {
            const result = await saveGmailLabelingConfig(projectId, sanitizeConfigForSave(config))
            setConfig(normalizeConfig(projectId, result?.config || sanitizeConfigForSave(config), connectedEmail))
            setSuccessMessage(translate('Gmail labeling settings saved.'))
        } catch (saveError) {
            setError(saveError.message || translate('Failed to save Gmail labeling settings.'))
        } finally {
            setSaving(false)
        }
    }

    const onRunSync = async () => {
        setSyncing(true)
        setError('')
        setSuccessMessage('')

        try {
            const result = await runGmailLabelingSync(projectId)
            setSyncResult(result)
            setSyncState(currentState => ({
                ...(currentState || {}),
                status: 'idle',
                lastError: result?.lastError || null,
                lastProcessedCount: result?.scanned || 0,
                lastLabeledCount: result?.labeled || 0,
                lastArchivedCount: result?.archived || 0,
            }))
            setSuccessMessage(translate('Gmail labeling sync completed.'))
        } catch (syncError) {
            setError(syncError.message || translate('Failed to run Gmail labeling sync.'))
        } finally {
            setSyncing(false)
        }
    }

    if (!isConnected) {
        return (
            <View style={localStyles.section}>
                <Text style={localStyles.helperText}>
                    {translate('Connect Gmail to configure prompt-based labeling.')}
                </Text>
            </View>
        )
    }

    if (needsReconnect) {
        return (
            <View style={localStyles.warningCard}>
                <Text style={localStyles.warningTitle}>{translate('Reconnect required')}</Text>
                <Text style={localStyles.helperText}>
                    {translate(
                        'This Gmail connection is missing modify permissions. Reconnect Gmail to enable label application and auto-archive.'
                    )}
                </Text>
            </View>
        )
    }

    if (!authStatus?.hasCredentials) {
        return null
    }

    return (
        <ScrollView
            style={[localStyles.scroll, { maxHeight: scrollMaxHeight }]}
            contentContainerStyle={localStyles.scrollContent}
        >
            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Gmail labeling')}</Text>
                <Text style={localStyles.helperText}>
                    {translate(
                        'Incoming inbox emails are classified by the prompt below. Matching labels can optionally auto-archive by removing the Inbox label.'
                    )}
                </Text>
                {connectedEmail ? (
                    <Text style={localStyles.summaryText}>
                        {translate('Connected Gmail account', { email: connectedEmail })}
                    </Text>
                ) : null}
            </View>

            {loading ? (
                <Text style={localStyles.helperText}>{translate('Loading Gmail labeling settings...')}</Text>
            ) : null}
            {error ? <Text style={localStyles.errorText}>{error}</Text> : null}
            {successMessage ? <Text style={localStyles.successText}>{successMessage}</Text> : null}

            <View style={localStyles.section}>
                <View style={localStyles.switchRow}>
                    <Text style={localStyles.inputLabel}>{translate('Enable Gmail labeling')}</Text>
                    <Switch
                        active={config.enabled}
                        activeSwitch={() => updateConfig({ enabled: true })}
                        deactiveSwitch={() => updateConfig({ enabled: false })}
                        disabled={!canManage}
                    />
                </View>

                <View style={localStyles.switchRow}>
                    <Text style={localStyles.inputLabel}>{translate('Process unread only')}</Text>
                    <Switch
                        active={config.processUnreadOnly}
                        activeSwitch={() => updateConfig({ processUnreadOnly: true })}
                        deactiveSwitch={() => updateConfig({ processUnreadOnly: false })}
                        disabled={!canManage}
                    />
                </View>

                <View style={localStyles.switchRow}>
                    <Text style={localStyles.inputLabel}>{translate('Only inbox messages')}</Text>
                    <Switch
                        active={config.onlyInbox}
                        activeSwitch={() => updateConfig({ onlyInbox: true })}
                        deactiveSwitch={() => updateConfig({ onlyInbox: false })}
                        disabled={!canManage}
                    />
                </View>
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.inputLabel}>{translate('Prompt')}</Text>
                <TextInput
                    multiline
                    value={config.prompt}
                    onChangeText={prompt => updateConfig({ prompt })}
                    editable={canManage}
                    style={[localStyles.input, localStyles.textArea]}
                    placeholder={translate('Classify incoming Gmail messages into the configured labels.')}
                    placeholderTextColor={colors.Text03}
                />
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Rules')}</Text>
                {config.labelDefinitions.map((label, index) => (
                    <View key={label.id || `${label.key}-${index}`} style={localStyles.labelCard}>
                        <Text style={localStyles.inputLabel}>
                            {translate('Gmail rule number', { number: index + 1 })}
                        </Text>
                        <TextInput
                            value={label.gmailLabelName}
                            onChangeText={gmailLabelName => updateLabel(index, { gmailLabelName })}
                            editable={canManage}
                            style={localStyles.input}
                            placeholder={translate('Gmail label name')}
                            placeholderTextColor={colors.Text03}
                        />
                        <TextInput
                            value={label.description}
                            onChangeText={description => updateLabel(index, { description })}
                            editable={canManage}
                            style={[localStyles.input, localStyles.descriptionInput]}
                            placeholder={translate('Describe when this label should be used')}
                            placeholderTextColor={colors.Text03}
                        />
                        <View style={localStyles.switchRow}>
                            <Text style={localStyles.inputLabel}>{translate('Auto-archive when matched')}</Text>
                            <Switch
                                active={!!label.autoArchive}
                                activeSwitch={() => updateLabel(index, { autoArchive: true })}
                                deactiveSwitch={() => updateLabel(index, { autoArchive: false })}
                                disabled={!canManage}
                            />
                        </View>
                        <Button
                            title={translate('Remove rule')}
                            type="ghost"
                            onPress={() => removeLabel(index)}
                            disabled={!canManage || config.labelDefinitions.length <= 1}
                            titleStyle={{ color: colors.UtilityRed200 }}
                            buttonStyle={{ alignSelf: 'flex-start', borderColor: colors.UtilityRed200, borderWidth: 1 }}
                        />
                    </View>
                ))}
                <Button
                    title={translate('Add rule')}
                    type="ghost"
                    onPress={addLabel}
                    disabled={!canManage}
                    buttonStyle={{ alignSelf: 'flex-start' }}
                />
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.inputLabel}>{translate('Max messages per run')}</Text>
                <TextInput
                    value={config.maxMessagesPerRun}
                    onChangeText={maxMessagesPerRun => updateConfig({ maxMessagesPerRun })}
                    editable={canManage}
                    style={localStyles.input}
                    keyboardType="numeric"
                    placeholder={translate('Gmail max messages placeholder')}
                    placeholderTextColor={colors.Text03}
                />
                <Text style={localStyles.inputLabel}>{translate('Confidence threshold')}</Text>
                <TextInput
                    value={config.confidenceThreshold}
                    onChangeText={confidenceThreshold => updateConfig({ confidenceThreshold })}
                    editable={canManage}
                    style={localStyles.input}
                    keyboardType="numeric"
                    placeholder={translate('Gmail confidence threshold placeholder')}
                    placeholderTextColor={colors.Text03}
                />
            </View>

            <SyncSummary state={syncState} result={syncResult} />

            <View style={localStyles.buttonRow}>
                <Button
                    title={translate('Save Gmail labeling settings')}
                    onPress={onSave}
                    disabled={!canManage || saving}
                    processing={saving}
                    processingTitle={translate('Saving')}
                    buttonStyle={{ marginRight: 12 }}
                />
                <Button
                    title={translate('Run Gmail sync now')}
                    type="ghost"
                    onPress={onRunSync}
                    disabled={!canManage || syncing}
                    processing={syncing}
                    processingTitle={translate('Syncing')}
                />
            </View>
        </ScrollView>
    )
}

const localStyles = StyleSheet.create({
    scroll: {
        marginTop: 16,
    },
    scrollContent: {
        paddingBottom: 8,
    },
    section: {
        marginBottom: 16,
    },
    sectionTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginBottom: 8,
    },
    helperText: {
        ...styles.body2,
        color: colors.Text03,
        lineHeight: 20,
    },
    summaryText: {
        ...styles.body2,
        color: '#ffffff',
        marginTop: 4,
    },
    inputLabel: {
        ...styles.caption1,
        color: colors.Text03,
        marginBottom: 6,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.Text03,
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 10,
        color: '#ffffff',
        marginBottom: 10,
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    textArea: {
        minHeight: 96,
        textAlignVertical: 'top',
    },
    descriptionInput: {
        minHeight: 72,
        textAlignVertical: 'top',
    },
    switchRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    labelCard: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        backgroundColor: 'rgba(255,255,255,0.03)',
    },
    buttonRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    warningCard: {
        marginTop: 16,
        padding: 12,
        borderRadius: 8,
        backgroundColor: 'rgba(255, 196, 0, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(255, 196, 0, 0.35)',
    },
    warningTitle: {
        ...styles.subtitle2,
        color: colors.UtilityYellow200,
        marginBottom: 6,
    },
    summaryCard: {
        marginBottom: 16,
        padding: 12,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    errorText: {
        ...styles.body2,
        color: colors.UtilityRed200,
        marginBottom: 8,
    },
    successText: {
        ...styles.body2,
        color: colors.Primary300,
        marginBottom: 8,
    },
})
