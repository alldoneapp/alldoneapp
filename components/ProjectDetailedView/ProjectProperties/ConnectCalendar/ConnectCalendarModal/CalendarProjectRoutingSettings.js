import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import CustomTextInput3 from '../../../../Feeds/CommentsTextInput/CustomTextInput3'
import Button from '../../../../UIControls/Button'
import Switch from '../../../../UIControls/Switch'
import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'
import { PLAN_STATUS_PREMIUM } from '../../../../Premium/PremiumHelper'
import { NEW_TOPIC_MODAL_THEME } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import {
    getCalendarProjectRoutingConfig,
    saveCalendarProjectRoutingConfig,
} from '../../../../../utils/backends/GoogleCalendar/calendarProjectRoutingFirestore'
import {
    DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT,
    buildProjectDefinitionsFromProjects,
    normalizeCalendarProjectRoutingConfig,
    sanitizeCalendarProjectRoutingConfigForSave,
} from './CalendarProjectRoutingSettings.helpers'

function stopEnterPropagation(event) {
    const key = event?.nativeEvent?.key || event?.key
    if (key === 'Enter') {
        event?.stopPropagation?.()
    }
}

function ProjectContextPreview({ projectDefinitions }) {
    const definitions = Array.isArray(projectDefinitions) ? projectDefinitions : []

    return (
        <View style={localStyles.section}>
            <Text style={localStyles.sectionTitle}>{translate('Active project context')}</Text>
            {definitions.length > 0 ? (
                definitions.map((project, index) => (
                    <View key={project.projectId || `${project.name}-${index}`} style={localStyles.previewCard}>
                        <Text style={localStyles.previewTitle}>{project.name}</Text>
                        <Text style={localStyles.helperText}>{project.routingDescription}</Text>
                    </View>
                ))
            ) : (
                <View style={localStyles.warningCard}>
                    <Text style={localStyles.warningTitle}>{translate('No active projects found')}</Text>
                    <Text style={localStyles.helperText}>
                        {translate('Calendar project routing needs at least one active project.')}
                    </Text>
                </View>
            )}
        </View>
    )
}

export default function CalendarProjectRoutingSettings({
    projectId,
    isConnected,
    isSignedIn,
    onUnsavedChangesChange,
    onRegisterCloseHandlers,
}) {
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const connectedEmail = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.calendarEmail || '')
    const [config, setConfig] = useState(() => normalizeCalendarProjectRoutingConfig(projectId, {}, connectedEmail))
    const [projectDefinitions, setProjectDefinitions] = useState(() =>
        buildProjectDefinitionsFromProjects(loggedUserProjects)
    )
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [successMessage, setSuccessMessage] = useState('')
    const [savedConfigSnapshot, setSavedConfigSnapshot] = useState(null)
    const [initialLoadComplete, setInitialLoadComplete] = useState(false)
    const [promptResetVersion, setPromptResetVersion] = useState(0)

    const isPremiumUser = premiumStatus === PLAN_STATUS_PREMIUM
    const canManage = isPremiumUser && isConnected && isSignedIn
    const currentConfigSnapshot = sanitizeCalendarProjectRoutingConfigForSave(config)
    const hasUnsavedChanges =
        !!savedConfigSnapshot && JSON.stringify(currentConfigSnapshot) !== JSON.stringify(savedConfigSnapshot)

    useEffect(() => {
        if (typeof onUnsavedChangesChange === 'function') onUnsavedChangesChange(hasUnsavedChanges)
    }, [hasUnsavedChanges, onUnsavedChangesChange])

    useEffect(() => {
        let isMounted = true

        const loadConfig = async () => {
            if (!isPremiumUser || !isConnected || !isSignedIn) {
                setInitialLoadComplete(true)
                return
            }

            setInitialLoadComplete(false)
            setLoading(true)
            setError('')
            try {
                const result = await getCalendarProjectRoutingConfig(projectId)
                if (!isMounted) return

                const normalizedConfig = normalizeCalendarProjectRoutingConfig(
                    projectId,
                    result?.config || {},
                    connectedEmail
                )
                setConfig(normalizedConfig)
                setProjectDefinitions(
                    Array.isArray(result?.projectDefinitions)
                        ? result.projectDefinitions
                        : buildProjectDefinitionsFromProjects(loggedUserProjects)
                )
                setSavedConfigSnapshot(sanitizeCalendarProjectRoutingConfigForSave(normalizedConfig))
            } catch (loadError) {
                if (!isMounted) return
                setError(loadError.message || translate('Failed to load Calendar project routing settings'))
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
    }, [projectId, isPremiumUser, isConnected, isSignedIn, connectedEmail, loggedUserProjects])

    useEffect(() => {
        const nextPreview = buildProjectDefinitionsFromProjects(loggedUserProjects)
        if (!projectDefinitions?.length && nextPreview.length > 0) {
            setProjectDefinitions(nextPreview)
        }
    }, [loggedUserProjects, projectDefinitions?.length])

    const updateConfig = patch => {
        setConfig(currentConfig => ({
            ...currentConfig,
            ...patch,
        }))
    }

    const resetPrompt = () => {
        updateConfig({ prompt: DEFAULT_CALENDAR_PROJECT_ROUTING_PROMPT })
        setPromptResetVersion(currentVersion => currentVersion + 1)
    }

    const saveSettings = async () => {
        setSaving(true)
        setError('')
        setSuccessMessage('')

        try {
            const result = await saveCalendarProjectRoutingConfig(
                projectId,
                sanitizeCalendarProjectRoutingConfigForSave(config)
            )
            const normalizedConfig = normalizeCalendarProjectRoutingConfig(
                projectId,
                result?.config || sanitizeCalendarProjectRoutingConfigForSave(config),
                connectedEmail
            )
            setConfig(normalizedConfig)
            setSavedConfigSnapshot(sanitizeCalendarProjectRoutingConfigForSave(normalizedConfig))
            setSuccessMessage(translate('Calendar project routing settings saved'))
            return true
        } catch (saveError) {
            setError(saveError.message || translate('Failed to save Calendar project routing settings'))
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

    if (!isPremiumUser) {
        return (
            <View style={localStyles.warningCard}>
                <Text style={localStyles.warningTitle}>{translate('Premium required')}</Text>
                <Text style={localStyles.helperText}>{translate('CalendarProjectRoutingPremiumOnlyDescription')}</Text>
            </View>
        )
    }

    if (!isConnected) {
        return (
            <View style={localStyles.section}>
                <Text style={localStyles.helperText}>{translate('Connect Calendar to configure project routing')}</Text>
            </View>
        )
    }

    if (!isSignedIn) return null

    const showInitialLoadingState = !initialLoadComplete && !error

    return (
        <View style={localStyles.container}>
            <View style={localStyles.section}>
                <View style={localStyles.headerRow}>
                    <Text style={localStyles.sectionTitle}>
                        {translate('Route calendar events to projects with AI')}
                    </Text>
                    <Switch
                        active={config.enabled}
                        activeSwitch={() => updateConfig({ enabled: true })}
                        deactiveSwitch={() => updateConfig({ enabled: false })}
                        disabled={!canManage}
                    />
                </View>
                <Text style={localStyles.helperText}>{translate('CalendarProjectRoutingDescription')}</Text>
                <Text style={localStyles.helperText}>{translate('CalendarProjectRoutingGoldCostDescription')}</Text>
                {connectedEmail ? (
                    <Text style={localStyles.summaryText}>
                        {translate('Connected Calendar account', { email: connectedEmail })}
                    </Text>
                ) : null}
            </View>

            {showInitialLoadingState ? (
                <View style={localStyles.loadingCard}>
                    <ActivityIndicator color={colors.Primary300} size="small" />
                    <Text style={localStyles.loadingText}>
                        {translate('Loading Calendar project routing settings')}
                    </Text>
                </View>
            ) : null}
            {error ? <Text style={localStyles.errorText}>{error}</Text> : null}
            {successMessage ? <Text style={localStyles.successText}>{successMessage}</Text> : null}

            {!showInitialLoadingState && config.enabled ? (
                <>
                    <View style={localStyles.section}>
                        <View style={localStyles.sectionHeaderRow}>
                            <Text style={localStyles.inputLabel}>{translate('Routing prompt')}</Text>
                            <Button
                                title={translate('Reset to defaults')}
                                type="ghost"
                                onPress={resetPrompt}
                                disabled={!canManage}
                                buttonStyle={localStyles.resetButton}
                            />
                        </View>
                        <CustomTextInput3
                            containerStyle={[localStyles.input, localStyles.textArea, localStyles.multilineInput]}
                            initialTextExtended={config.prompt}
                            placeholder={translate('Choose the best project for each calendar event')}
                            placeholderTextColor={colors.Text03}
                            multiline={true}
                            onChangeText={prompt => updateConfig({ prompt })}
                            styleTheme={NEW_TOPIC_MODAL_THEME}
                            disabledTabKey={true}
                            disabledTags={true}
                            disabledEdition={!canManage}
                            externalTextStyle={localStyles.multilineInputText}
                            keepBreakLines={true}
                            allowPlainEnterBreakLines={true}
                            onKeyPress={stopEnterPropagation}
                            key={`calendar-routing-prompt-${promptResetVersion}-${projectId}-${connectedEmail}`}
                        />
                    </View>
                    <ProjectContextPreview projectDefinitions={projectDefinitions} />
                </>
            ) : null}

            {!showInitialLoadingState ? (
                <View style={localStyles.buttonRow}>
                    <Button
                        title={translate('Save Calendar project routing settings')}
                        onPress={saveSettings}
                        processing={saving}
                        processingTitle={translate('Saving')}
                        disabled={!canManage || saving || !hasUnsavedChanges}
                    />
                </View>
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 20,
    },
    section: {
        marginBottom: 20,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    sectionTitle: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    inputLabel: {
        ...styles.subtitle2,
        color: '#ffffff',
    },
    helperText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
    summaryText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 8,
    },
    input: {
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        backgroundColor: colors.Secondary300,
    },
    textArea: {
        minHeight: 156,
    },
    multilineInput: {
        padding: 8,
    },
    multilineInputText: {
        ...styles.body2,
        color: '#ffffff',
        outlineStyle: 'none',
    },
    resetButton: {
        alignSelf: 'flex-end',
    },
    previewCard: {
        borderWidth: 1,
        borderColor: colors.Grey400,
        borderRadius: 4,
        padding: 12,
        marginTop: 8,
    },
    previewTitle: {
        ...styles.subtitle2,
        color: '#ffffff',
    },
    warningCard: {
        borderWidth: 1,
        borderColor: colors.UtilityYellow200,
        borderRadius: 4,
        padding: 12,
        marginTop: 16,
    },
    warningTitle: {
        ...styles.subtitle2,
        color: '#ffffff',
    },
    loadingCard: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    loadingText: {
        ...styles.body2,
        color: colors.Text03,
        marginLeft: 8,
    },
    errorText: {
        ...styles.body2,
        color: colors.UtilityRed200,
        marginBottom: 12,
    },
    successText: {
        ...styles.body2,
        color: colors.UtilityGreen200,
        marginBottom: 12,
    },
    buttonRow: {
        alignItems: 'flex-end',
    },
})
