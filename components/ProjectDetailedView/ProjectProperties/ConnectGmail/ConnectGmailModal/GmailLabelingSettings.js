import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import CustomTextInput3 from '../../../../Feeds/CommentsTextInput/CustomTextInput3'
import Button from '../../../../UIControls/Button'
import Switch from '../../../../UIControls/Switch'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import { PLAN_STATUS_PREMIUM } from '../../../../Premium/PremiumHelper'
import { NEW_TOPIC_MODAL_THEME } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import {
    getGmailLabelingConfig,
    runGmailLabelingSync,
    saveGmailLabelingConfig,
} from '../../../../../utils/backends/Gmail/gmailLabelingFirestore'

const MAX_LOOKBACK_DAYS = 30
const MAX_MESSAGES_PER_RUN = 100
const GMAIL_CLASSIFIER_SYSTEM_PROMPT =
    'You classify incoming emails into exactly one configured label or no match. Return strict JSON only with keys matched, labelKey, confidence, reasoning. Never invent labels. Confidence must be a number between 0 and 1.'

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
        model: config.model || 'MODEL_GPT5_4',
        processUnreadOnly: typeof config.processUnreadOnly === 'boolean' ? config.processUnreadOnly : true,
        onlyInbox: typeof config.onlyInbox === 'boolean' ? config.onlyInbox : true,
        lookbackDays: Number.isFinite(config.lookbackDays) ? String(config.lookbackDays) : '7',
        maxMessagesPerRun: Number.isFinite(config.maxMessagesPerRun) ? String(config.maxMessagesPerRun) : '20',
        confidenceThreshold: Number.isFinite(config.confidenceThreshold) ? String(config.confidenceThreshold) : '0.7',
        labelDefinitions,
    }
}

function sanitizeConfigForSave(config) {
    const parsedLookbackDays = parseInt(config.lookbackDays, 10)
    const parsedMaxMessages = parseInt(config.maxMessagesPerRun, 10)
    const parsedConfidenceThreshold = parseFloat(config.confidenceThreshold)

    return {
        enabled: !!config.enabled,
        gmailEmail: config.gmailEmail || '',
        prompt: config.prompt || '',
        model: config.model || 'MODEL_GPT5_4',
        processUnreadOnly: !!config.processUnreadOnly,
        onlyInbox: !!config.onlyInbox,
        lookbackDays: Number.isFinite(parsedLookbackDays)
            ? Math.min(Math.max(parsedLookbackDays, 1), MAX_LOOKBACK_DAYS)
            : 7,
        maxMessagesPerRun: Number.isFinite(parsedMaxMessages)
            ? Math.min(Math.max(parsedMaxMessages, 1), MAX_MESSAGES_PER_RUN)
            : 20,
        confidenceThreshold: Number.isFinite(parsedConfidenceThreshold) ? parsedConfidenceThreshold : 0.7,
        labelDefinitions: (config.labelDefinitions || []).map(({ id, ...label }) => ({
            ...label,
            autoArchive: !!label.autoArchive,
        })),
    }
}

function normalizeSyncDate(value) {
    if (!value) return null
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
    if (typeof value?.toDate === 'function') {
        const date = value.toDate()
        return Number.isNaN(date?.getTime?.()) ? null : date
    }
    if (typeof value?.seconds === 'number') {
        const date = new Date(value.seconds * 1000)
        return Number.isNaN(date.getTime()) ? null : date
    }
    if (typeof value === 'number') {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? null : date
    }
    if (typeof value === 'string') {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? null : date
    }
    return null
}

function formatSyncDateTime(value) {
    const date = normalizeSyncDate(value)
    if (!date) return ''

    return new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(date)
}

function stopEnterPropagation(event) {
    const key = event?.nativeEvent?.key || event?.key
    if (key === 'Enter') {
        event?.stopPropagation?.()
    }
}

function SyncSummary({ state, result }) {
    const lastError = result?.lastError || state?.lastError
    const syncDateLabel = formatSyncDateTime(result?.lastSyncAt || state?.lastSyncAt || state?.lastSuccessfulSyncAt)
    const lastClassifiedCount = typeof result?.classified === 'number' ? result.classified : null
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
    const goldSpent = typeof result?.goldSpent === 'number' ? result.goldSpent : 0
    const estimatedNormalGoldSpent =
        typeof result?.estimatedNormalGoldSpent === 'number' ? result.estimatedNormalGoldSpent : 0
    const hasManualSyncResult = !!result

    return (
        <View style={localStyles.summaryCard}>
            <Text style={localStyles.sectionTitle}>{translate('Gmail sync status')}</Text>
            {syncDateLabel ? <Text style={localStyles.summaryText}>{`From: ${syncDateLabel}`}</Text> : null}
            <Text style={localStyles.summaryText}>
                {translate('Gmail sync scanned', { count: lastProcessedCount })}
            </Text>
            {lastClassifiedCount !== null ? (
                <Text style={localStyles.summaryText}>{`Checked: ${lastClassifiedCount}`}</Text>
            ) : null}
            <Text style={localStyles.summaryText}>{translate('Gmail sync labeled', { count: lastLabeledCount })}</Text>
            <Text style={localStyles.summaryText}>
                {translate('Gmail sync archived', { count: lastArchivedCount })}
            </Text>
            {hasManualSyncResult ? (
                <Text style={localStyles.summaryText}>{translate('Gmail sync gold spent', { count: goldSpent })}</Text>
            ) : null}
            {hasManualSyncResult ? (
                <Text
                    style={localStyles.summaryText}
                >{`Normal token-based gold cost: ${estimatedNormalGoldSpent}`}</Text>
            ) : null}
            {state?.status ? (
                <Text style={localStyles.summaryText}>{translate('Gmail sync state', { state: state.status })}</Text>
            ) : null}
            {lastError ? <Text style={localStyles.errorText}>{lastError}</Text> : null}
        </View>
    )
}

function formatClassificationLabel(entry = {}) {
    if (entry.selectedGmailLabelName) return entry.selectedGmailLabelName
    if (entry.skippedReason === 'no_match') return 'No match'
    if (entry.skippedReason === 'missing_label_definition') return 'Missing label definition'
    if (entry.skippedReason === 'insufficient_gold') return 'Skipped: insufficient gold'
    if (entry.skippedReason === 'processing_error') return 'Processing error'
    return 'Skipped'
}

function formatReasoning(entry = {}) {
    const reasoning = typeof entry.reasoning === 'string' ? entry.reasoning.trim() : ''
    return reasoning || 'No reasoning available.'
}

function SyncAuditSection({ entries }) {
    const [expandedIds, setExpandedIds] = useState({})

    if (!Array.isArray(entries) || entries.length === 0) return null

    const toggleExpanded = id => {
        setExpandedIds(currentState => ({
            ...currentState,
            [id]: !currentState[id],
        }))
    }

    return (
        <View style={localStyles.auditSection}>
            <Text style={localStyles.sectionTitle}>Latest 20 emails</Text>
            {entries.map((entry, index) => {
                const rowId = entry.id || entry.gmailMessageId || `audit-${index}`
                const isExpanded = !!expandedIds[rowId]
                const classificationLabel = formatClassificationLabel(entry)
                return (
                    <View key={rowId} style={localStyles.auditCard}>
                        <TouchableOpacity onPress={() => toggleExpanded(rowId)} activeOpacity={0.8}>
                            <Text style={localStyles.auditSubject}>{entry.subject || '(No subject)'}</Text>
                            <Text style={localStyles.auditMeta}>{entry.from || 'Unknown sender'}</Text>
                            <Text
                                style={localStyles.auditClassification}
                            >{`Classification: ${classificationLabel}`}</Text>
                            <Text style={localStyles.auditToggle}>{isExpanded ? 'Hide details' : 'Show details'}</Text>
                        </TouchableOpacity>
                        {isExpanded ? (
                            <View style={localStyles.auditDetails}>
                                <Text style={localStyles.auditDetailText}>{`Why: ${formatReasoning(entry)}`}</Text>
                                {entry.snippet ? (
                                    <Text style={localStyles.auditDetailText}>{`Snippet: ${entry.snippet}`}</Text>
                                ) : null}
                                {typeof entry.confidence === 'number' ? (
                                    <Text style={localStyles.auditDetailText}>{`Confidence: ${entry.confidence}`}</Text>
                                ) : null}
                                {entry.processedAt ? (
                                    <Text style={localStyles.auditDetailText}>
                                        {`Processed: ${formatSyncDateTime(entry.processedAt)}`}
                                    </Text>
                                ) : null}
                            </View>
                        ) : null}
                    </View>
                )
            })}
        </View>
    )
}

export default function GmailLabelingSettings({
    projectId,
    isConnected,
    authStatus,
    onUnsavedChangesChange,
    onRegisterCloseHandlers,
}) {
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const [config, setConfig] = useState(() => normalizeConfig(projectId))
    const [syncState, setSyncState] = useState(null)
    const [syncResult, setSyncResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [syncing, setSyncing] = useState(false)
    const [error, setError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')
    const [savedConfigSnapshot, setSavedConfigSnapshot] = useState(null)
    const [initialLoadComplete, setInitialLoadComplete] = useState(false)
    const [recentAuditEntries, setRecentAuditEntries] = useState([])

    const connectedEmail = authStatus?.email || config.gmailEmail || ''
    const isPremiumUser = premiumStatus === PLAN_STATUS_PREMIUM
    const needsReconnect = isConnected && authStatus?.hasCredentials && authStatus?.hasModifyScope === false
    const canManage = isPremiumUser && isConnected && authStatus?.hasCredentials && authStatus?.hasModifyScope !== false
    const currentConfigSnapshot = sanitizeConfigForSave(config)
    const hasUnsavedChanges =
        !!savedConfigSnapshot && JSON.stringify(currentConfigSnapshot) !== JSON.stringify(savedConfigSnapshot)

    useEffect(() => {
        if (typeof onUnsavedChangesChange === 'function') onUnsavedChangesChange(hasUnsavedChanges)
    }, [hasUnsavedChanges, onUnsavedChangesChange])

    useEffect(() => {
        let isMounted = true

        const loadConfig = async () => {
            if (!isPremiumUser || !isConnected || !authStatus?.hasCredentials) {
                setInitialLoadComplete(true)
                return
            }

            setInitialLoadComplete(false)
            setLoading(true)
            setError('')
            try {
                const result = await getGmailLabelingConfig(projectId)
                if (!isMounted) return

                const normalizedConfig = normalizeConfig(projectId, result?.config || {}, connectedEmail)
                setConfig(normalizedConfig)
                setSyncState(result?.state || null)
                setRecentAuditEntries(Array.isArray(result?.recentAuditEntries) ? result.recentAuditEntries : [])
                setSavedConfigSnapshot(sanitizeConfigForSave(normalizedConfig))
            } catch (loadError) {
                if (!isMounted) return
                setError(loadError.message || translate('Failed to load Gmail labeling settings'))
            } finally {
                if (isMounted) {
                    setLoading(false)
                    setInitialLoadComplete(true)
                }
            }
        }

        loadConfig()

        return () => {
            isMounted = false
        }
    }, [projectId, isPremiumUser, isConnected, authStatus?.hasCredentials, authStatus?.hasModifyScope, connectedEmail])

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

    const saveSettings = async () => {
        setSaving(true)
        setError('')
        setSuccessMessage('')

        try {
            const result = await saveGmailLabelingConfig(projectId, sanitizeConfigForSave(config))
            const normalizedConfig = normalizeConfig(
                projectId,
                result?.config || sanitizeConfigForSave(config),
                connectedEmail
            )
            setConfig(normalizedConfig)
            setSavedConfigSnapshot(sanitizeConfigForSave(normalizedConfig))
            setSuccessMessage(translate('Gmail labeling settings saved'))
            return true
        } catch (saveError) {
            setError(saveError.message || translate('Failed to save Gmail labeling settings'))
            return false
        } finally {
            setSaving(false)
        }
    }

    useEffect(() => {
        if (typeof onRegisterCloseHandlers !== 'function') return

        onRegisterCloseHandlers({
            saveAndClose: async () => await saveSettings(),
        })
    }, [config, connectedEmail, onRegisterCloseHandlers])

    const onSave = async () => {
        await saveSettings()
    }

    const onRunSync = async () => {
        setSyncing(true)
        setError('')
        setSuccessMessage('')

        try {
            const result = await runGmailLabelingSync(projectId, true)
            setSyncResult(result)
            setRecentAuditEntries(Array.isArray(result?.recentAuditEntries) ? result.recentAuditEntries : [])
            setSyncState(currentState => ({
                ...(currentState || {}),
                status: 'idle',
                lastError: result?.lastError || null,
                lastProcessedCount: result?.scanned || 0,
                lastLabeledCount: result?.labeled || 0,
                lastArchivedCount: result?.archived || 0,
            }))
            setSuccessMessage(translate('Gmail labeling sync completed'))
        } catch (syncError) {
            setError(syncError.message || translate('Failed to run Gmail labeling sync'))
        } finally {
            setSyncing(false)
        }
    }

    if (!isPremiumUser) {
        return (
            <View style={localStyles.warningCard}>
                <Text style={localStyles.warningTitle}>{translate('Premium required')}</Text>
                <Text style={localStyles.helperText}>{translate('GmailLabelingPremiumOnlyDescription')}</Text>
            </View>
        )
    }

    if (!isConnected) {
        return (
            <View style={localStyles.section}>
                <Text style={localStyles.helperText}>
                    {translate('Connect Gmail to configure prompt-based labeling')}
                </Text>
            </View>
        )
    }

    if (needsReconnect) {
        return (
            <View style={localStyles.warningCard}>
                <Text style={localStyles.warningTitle}>{translate('Reconnect required')}</Text>
                <Text style={localStyles.helperText}>{translate('GmailLabelingReconnectDescription')}</Text>
            </View>
        )
    }

    if (!authStatus?.hasCredentials) {
        return null
    }

    const showInitialLoadingState = !initialLoadComplete && !error

    return (
        <View style={localStyles.container}>
            <View style={localStyles.section}>
                <View style={localStyles.headerRow}>
                    <Text style={localStyles.sectionTitle}>{translate('Gmail labeling')}</Text>
                    <View style={localStyles.headerSwitchRow}>
                        <Text style={localStyles.inputLabel}>{translate('Enable Gmail labeling')}</Text>
                        <Switch
                            active={config.enabled}
                            activeSwitch={() => updateConfig({ enabled: true })}
                            deactiveSwitch={() => updateConfig({ enabled: false })}
                            disabled={!canManage}
                        />
                    </View>
                </View>
                <Text style={localStyles.helperText}>{translate('GmailLabelingDescription')}</Text>
                <Text style={localStyles.helperText}>{translate('GmailLabelingGoldCostDescription')}</Text>
                {connectedEmail ? (
                    <Text style={localStyles.summaryText}>
                        {translate('Connected Gmail account', { email: connectedEmail })}
                    </Text>
                ) : null}
            </View>

            {showInitialLoadingState ? (
                <View style={localStyles.loadingCard}>
                    <ActivityIndicator color={colors.Primary300} size="small" />
                    <Text style={localStyles.loadingText}>{translate('Loading Gmail labeling settings')}</Text>
                </View>
            ) : null}
            {error ? <Text style={localStyles.errorText}>{error}</Text> : null}
            {successMessage ? <Text style={localStyles.successText}>{successMessage}</Text> : null}

            {!showInitialLoadingState ? (
                <>
                    {config.enabled ? (
                        <>
                            <View style={localStyles.section}>
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
                                <Text style={localStyles.inputLabel}>System prompt</Text>
                                <CustomTextInput3
                                    containerStyle={[
                                        localStyles.input,
                                        localStyles.systemPromptInput,
                                        localStyles.multilineInput,
                                    ]}
                                    initialTextExtended={GMAIL_CLASSIFIER_SYSTEM_PROMPT}
                                    placeholder={''}
                                    placeholderTextColor={colors.Text03}
                                    multiline={true}
                                    onChangeText={() => {}}
                                    styleTheme={NEW_TOPIC_MODAL_THEME}
                                    disabledTabKey={true}
                                    disabledTags={true}
                                    disabledEdition={true}
                                    externalTextStyle={localStyles.multilineInputText}
                                    keepBreakLines={true}
                                    key={'gmail-system-prompt'}
                                />
                            </View>

                            <View style={localStyles.section}>
                                <Text style={localStyles.inputLabel}>User prompt</Text>
                                <CustomTextInput3
                                    containerStyle={[
                                        localStyles.input,
                                        localStyles.textArea,
                                        localStyles.multilineInput,
                                    ]}
                                    initialTextExtended={config.prompt}
                                    placeholder={translate(
                                        'Classify incoming Gmail messages into the configured labels'
                                    )}
                                    placeholderTextColor={colors.Text03}
                                    multiline={true}
                                    onChangeText={prompt => updateConfig({ prompt })}
                                    styleTheme={NEW_TOPIC_MODAL_THEME}
                                    disabledTabKey={true}
                                    disabledTags={true}
                                    disabledEdition={!canManage}
                                    externalTextStyle={localStyles.multilineInputText}
                                    keepBreakLines={true}
                                    onKeyPress={stopEnterPropagation}
                                    key={`gmail-prompt-${projectId}-${connectedEmail || 'default'}`}
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
                                        <CustomTextInput3
                                            containerStyle={[
                                                localStyles.input,
                                                localStyles.descriptionInput,
                                                localStyles.multilineInput,
                                            ]}
                                            initialTextExtended={label.description}
                                            placeholder={translate('Describe when this label should be used')}
                                            placeholderTextColor={colors.Text03}
                                            multiline={true}
                                            onChangeText={description => updateLabel(index, { description })}
                                            styleTheme={NEW_TOPIC_MODAL_THEME}
                                            disabledTabKey={true}
                                            disabledTags={true}
                                            disabledEdition={!canManage}
                                            externalTextStyle={localStyles.multilineInputText}
                                            keepBreakLines={true}
                                            onKeyPress={stopEnterPropagation}
                                            key={`gmail-rule-${label.id || index}-${label.gmailLabelName || 'rule'}`}
                                        />
                                        <View style={localStyles.switchRow}>
                                            <Text style={localStyles.inputLabel}>
                                                {translate('Auto-archive when matched')}
                                            </Text>
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
                                            buttonStyle={{
                                                alignSelf: 'flex-start',
                                                borderColor: colors.UtilityRed200,
                                                borderWidth: 1,
                                            }}
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
                                <Text style={localStyles.helperText}>{translate('GmailMaxMessagesDescription')}</Text>
                                <Text style={localStyles.inputLabel}>{translate('Gmail lookback days')}</Text>
                                <TextInput
                                    value={config.lookbackDays}
                                    onChangeText={lookbackDays => updateConfig({ lookbackDays })}
                                    editable={canManage}
                                    style={localStyles.input}
                                    keyboardType="numeric"
                                    placeholder={translate('Gmail lookback days placeholder')}
                                    placeholderTextColor={colors.Text03}
                                />
                                <Text style={localStyles.helperText}>{translate('GmailLookbackDaysDescription')}</Text>
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
                            <SyncAuditSection entries={recentAuditEntries} />
                        </>
                    ) : null}

                    {hasUnsavedChanges ? (
                        <View style={localStyles.warningCard}>
                            <Text style={localStyles.warningTitle}>{translate('Unsaved changes')}</Text>
                            <Text style={localStyles.helperText}>
                                {translate('GmailLabelingUnsavedChangesDescription')}
                            </Text>
                        </View>
                    ) : null}

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
                            disabled={!canManage || syncing || hasUnsavedChanges}
                            processing={syncing}
                            processingTitle={translate('Syncing')}
                        />
                    </View>
                </>
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 16,
    },
    section: {
        marginBottom: 16,
    },
    sectionTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginBottom: 8,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    headerSwitchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 16,
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
    loadingCard: {
        minHeight: 140,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 24,
        marginBottom: 16,
    },
    loadingText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 12,
        textAlign: 'center',
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
    systemPromptInput: {
        minHeight: 88,
        opacity: 0.75,
    },
    descriptionInput: {
        minHeight: 104,
        paddingTop: 12,
        textAlignVertical: 'top',
    },
    multilineInput: {
        paddingVertical: 3,
        paddingHorizontal: 16,
    },
    multilineInputText: {
        ...styles.body2,
        color: '#ffffff',
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
    auditSection: {
        marginBottom: 16,
    },
    auditCard: {
        marginBottom: 10,
        padding: 12,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
    },
    auditSubject: {
        ...styles.subtitle2,
        color: '#ffffff',
        marginBottom: 4,
    },
    auditMeta: {
        ...styles.caption1,
        color: colors.Text03,
        marginBottom: 4,
    },
    auditClassification: {
        ...styles.body2,
        color: '#ffffff',
    },
    auditToggle: {
        ...styles.caption1,
        color: colors.Primary300,
        marginTop: 6,
    },
    auditDetails: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
    },
    auditDetailText: {
        ...styles.body2,
        color: colors.Text03,
        marginBottom: 6,
        lineHeight: 20,
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
