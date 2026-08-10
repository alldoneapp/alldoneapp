import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { IntegrationsPendingContent, useIsInsideIntegrationsLoadingRegion } from './IntegrationsLoadingRegion'
import {
    getVmAgentSettings,
    setDefaultVmAgent,
    setDefaultVmAgentModel,
    setDefaultVmAgentReasoningEffort,
    setDefaultVmApprovalPolicy,
} from '../../../utils/backends/firestore'

const NO_MODEL_DEFAULT_KEY = 'none'

// The picker offers families ("Opus", "Sol"), never concrete versions — the family is resolved
// to its newest release when the VM task actually starts. See functions/Assistant/vmAgentModelCatalog.js.
function familiesForAgent(modelCatalogs, agent) {
    const catalog = modelCatalogs && agent ? modelCatalogs[agent] : null
    return catalog && Array.isArray(catalog.families) ? catalog.families : []
}

const AGENTS = [
    { id: 'claude', label: 'Claude' },
    { id: 'codex', label: 'Codex' },
]

const APPROVAL_POLICIES = [
    { id: 'strict', label: 'Strict' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'permissive', label: 'Permissive' },
]

const EFFORTS = [
    { id: null, key: 'none', label: 'No default' },
    { id: 'low', key: 'low', label: 'Low effort' },
    { id: 'medium', key: 'medium', label: 'Medium effort' },
    { id: 'high', key: 'high', label: 'High effort' },
    { id: 'xhigh', key: 'xhigh', label: 'Extra high effort' },
]

export default function DefaultVmAgentSection() {
    const [selectedAgent, setSelectedAgent] = useState(null)
    const [selectedEffort, setSelectedEffort] = useState(null)
    const [selectedPolicy, setSelectedPolicy] = useState(null)
    const [savingAgent, setSavingAgent] = useState(null)
    const [savingEffort, setSavingEffort] = useState('')
    const [savingPolicy, setSavingPolicy] = useState('')
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState('')
    // Per-agent map, so switching the agent toggle keeps the other agent's saved family.
    const [selectedFamilies, setSelectedFamilies] = useState({ claude: null, codex: null })
    const [modelCatalogs, setModelCatalogs] = useState(null)
    const [savingFamily, setSavingFamily] = useState('')

    useEffect(() => {
        let mounted = true
        getVmAgentSettings()
            .then(settings => {
                if (mounted) {
                    setSelectedAgent(settings.effectiveDefaultAgent)
                    setSelectedEffort(
                        Object.prototype.hasOwnProperty.call(settings, 'effectiveDefaultReasoningEffort')
                            ? settings.effectiveDefaultReasoningEffort
                            : settings.defaultReasoningEffort || 'medium'
                    )
                    setSelectedPolicy(settings.effectiveDefaultApprovalPolicy || 'balanced')
                    setSelectedFamilies({
                        claude: (settings.defaultModelFamilies && settings.defaultModelFamilies.claude) || null,
                        codex: (settings.defaultModelFamilies && settings.defaultModelFamilies.codex) || null,
                    })
                    setModelCatalogs(settings.modelCatalogs || null)
                    setLoaded(true)
                }
            })
            .catch(loadError => {
                if (mounted) setError(loadError?.message || translate('Could not load VM defaults.'))
            })
        return () => {
            mounted = false
        }
    }, [])

    const selectAgent = async agent => {
        if (savingAgent || savingEffort || savingPolicy || savingFamily || agent === selectedAgent) return

        const previousAgent = selectedAgent
        setSelectedAgent(agent)
        setSavingAgent(agent)
        setError('')
        try {
            await setDefaultVmAgent(agent)
        } catch (saveError) {
            setSelectedAgent(previousAgent)
            setError(saveError?.message || translate('Could not save the default VM agent.'))
        } finally {
            setSavingAgent(null)
        }
    }

    const selectPolicy = async policy => {
        if (savingAgent || savingEffort || savingPolicy || policy === selectedPolicy) return

        const previousPolicy = selectedPolicy
        setSelectedPolicy(policy)
        setSavingPolicy(policy)
        setError('')
        try {
            await setDefaultVmApprovalPolicy(policy)
        } catch (saveError) {
            setSelectedPolicy(previousPolicy)
            setError(saveError?.message || translate('Could not save the default VM approval policy.'))
        } finally {
            setSavingPolicy('')
        }
    }

    const selectFamily = async family => {
        const familyKey = family || NO_MODEL_DEFAULT_KEY
        if (!selectedAgent || savingAgent || savingEffort || savingPolicy || savingFamily) return
        if (family === selectedFamilies[selectedAgent]) return

        const agent = selectedAgent
        const previousFamily = selectedFamilies[agent]
        setSelectedFamilies(current => ({ ...current, [agent]: family }))
        setSavingFamily(familyKey)
        setError('')
        try {
            await setDefaultVmAgentModel(agent, family)
        } catch (saveError) {
            setSelectedFamilies(current => ({ ...current, [agent]: previousFamily }))
            setError(saveError?.message || translate('Could not save the default VM model.'))
        } finally {
            setSavingFamily('')
        }
    }

    const selectEffort = async effort => {
        const effortKey = effort || 'none'
        if (savingAgent || savingEffort || effort === selectedEffort) return

        const previousEffort = selectedEffort
        setSelectedEffort(effort)
        setSavingEffort(effortKey)
        setError('')
        try {
            await setDefaultVmAgentReasoningEffort(effort)
        } catch (saveError) {
            setSelectedEffort(previousEffort)
            setError(saveError?.message || translate('Could not save the default VM effort.'))
        } finally {
            setSavingEffort('')
        }
    }

    const agentControlsDisabled = !!savingAgent || !!savingEffort || !!savingPolicy || !!savingFamily || !loaded
    const isPending = !loaded && !error
    const insideLoadingRegion = useIsInsideIntegrationsLoadingRegion()

    return (
        <IntegrationsPendingContent loadingKey="vmAgentDefaults" pending={isPending} style={localStyles.section}>
            <Text style={[styles.title6, localStyles.sectionTitle]}>{translate('Default VM agent')}</Text>
            <Text style={[styles.body2, localStyles.sectionDescription]}>
                {translate(
                    'Choose which agent runs VM tasks when no agent is explicitly requested. An explicit choice always takes priority.'
                )}
            </Text>
            <View style={localStyles.options}>
                {AGENTS.map(agent => {
                    const selected = selectedAgent === agent.id
                    return (
                        <TouchableOpacity
                            key={agent.id}
                            style={[localStyles.option, selected && localStyles.selectedOption]}
                            onPress={() => selectAgent(agent.id)}
                            disabled={agentControlsDisabled}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled: agentControlsDisabled }}
                        >
                            <Text style={[styles.subtitle2, selected && localStyles.selectedLabel]}>
                                {translate(agent.label)}
                            </Text>
                            {savingAgent === agent.id && (
                                <ActivityIndicator size="small" color={colors.Primary100} style={localStyles.spinner} />
                            )}
                        </TouchableOpacity>
                    )
                })}
            </View>
            <Text style={[styles.title6, localStyles.effortTitle]}>{translate('Default VM model')}</Text>
            <Text style={[styles.body2, localStyles.sectionDescription]}>
                {translate(
                    'Optionally pick the model family used by the selected agent. The latest version of that family is used automatically, so you never have to update a version number. Each agent keeps its own choice.'
                )}
            </Text>
            <View style={[localStyles.options, localStyles.effortOptions]}>
                {[{ id: null, key: NO_MODEL_DEFAULT_KEY, label: translate('No default') }]
                    .concat(
                        familiesForAgent(modelCatalogs, selectedAgent).map(family => ({
                            id: family.id,
                            key: family.id,
                            // Provider-supplied family names ("Opus", "Sol") are proper nouns, not
                            // translatable UI strings — render them as discovered.
                            label: family.label,
                        }))
                    )
                    .map(family => {
                        const selected = selectedAgent ? selectedFamilies[selectedAgent] === family.id : false
                        const disabled = !!savingAgent || !!savingEffort || !!savingPolicy || !!savingFamily || !loaded
                        return (
                            <TouchableOpacity
                                key={family.key}
                                style={[
                                    localStyles.option,
                                    localStyles.effortOption,
                                    selected && localStyles.selectedOption,
                                ]}
                                onPress={() => selectFamily(family.id)}
                                disabled={disabled}
                                accessibilityRole="radio"
                                accessibilityState={{ selected, disabled }}
                            >
                                <Text style={[styles.subtitle2, selected && localStyles.selectedLabel]}>
                                    {family.label}
                                </Text>
                                {savingFamily === family.key && (
                                    <ActivityIndicator
                                        size="small"
                                        color={colors.Primary100}
                                        style={localStyles.spinner}
                                    />
                                )}
                            </TouchableOpacity>
                        )
                    })}
            </View>
            {loaded && modelCatalogs && selectedAgent && modelCatalogs[selectedAgent]?.source === 'fallback' && (
                <Text style={localStyles.hint}>
                    {translate('Could not reach the model provider, so a built-in list of families is shown.')}
                </Text>
            )}
            <Text style={[styles.title6, localStyles.effortTitle]}>{translate('Default VM effort')}</Text>
            <Text style={[styles.body2, localStyles.sectionDescription]}>
                {translate(
                    'Optionally choose the reasoning effort used when a VM task does not explicitly request one. No default keeps the agent-specific behavior.'
                )}
            </Text>
            <View style={[localStyles.options, localStyles.effortOptions]}>
                {EFFORTS.map(effort => {
                    const selected = selectedEffort === effort.id
                    return (
                        <TouchableOpacity
                            key={effort.key}
                            style={[
                                localStyles.option,
                                localStyles.effortOption,
                                selected && localStyles.selectedOption,
                            ]}
                            onPress={() => selectEffort(effort.id)}
                            disabled={!!savingAgent || !!savingEffort || !loaded}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled: !!savingAgent || !!savingEffort || !loaded }}
                        >
                            <Text style={[styles.subtitle2, selected && localStyles.selectedLabel]}>
                                {translate(effort.label)}
                            </Text>
                            {savingEffort === effort.key && (
                                <ActivityIndicator size="small" color={colors.Primary100} style={localStyles.spinner} />
                            )}
                        </TouchableOpacity>
                    )
                })}
            </View>
            <Text style={[styles.title6, localStyles.effortTitle]}>{translate('VM approval policy')}</Text>
            <Text style={[styles.body2, localStyles.sectionDescription]}>
                {translate(
                    'Controls which operations an interactive VM task can run without asking you first. Balanced auto-approves read-only internet access and pushing a feature branch or opening a merge request, and still asks before merging, pushing to the base branch, deployments and anything touching secrets.'
                )}
            </Text>
            <View style={[localStyles.options, localStyles.effortOptions]}>
                {APPROVAL_POLICIES.map(policy => {
                    const selected = selectedPolicy === policy.id
                    const disabled = !!savingAgent || !!savingEffort || !!savingPolicy || !loaded
                    return (
                        <TouchableOpacity
                            key={policy.id}
                            style={[
                                localStyles.option,
                                localStyles.effortOption,
                                selected && localStyles.selectedOption,
                            ]}
                            onPress={() => selectPolicy(policy.id)}
                            disabled={disabled}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled }}
                        >
                            <Text style={[styles.subtitle2, selected && localStyles.selectedLabel]}>
                                {translate(policy.label)}
                            </Text>
                            {savingPolicy === policy.id && (
                                <ActivityIndicator size="small" color={colors.Primary100} style={localStyles.spinner} />
                            )}
                        </TouchableOpacity>
                    )
                })}
            </View>
            {/* Inside Settings > Integrations the region owns the single, bigger spinner. */}
            {isPending && !insideLoadingRegion && <ActivityIndicator size="small" color={colors.Primary100} />}
            {!!error && <Text style={localStyles.error}>{error}</Text>}
        </IntegrationsPendingContent>
    )
}

const localStyles = StyleSheet.create({
    section: {
        marginBottom: 32,
    },
    sectionTitle: {
        color: colors.Text01,
        marginBottom: 4,
    },
    sectionDescription: {
        color: colors.Text02,
        marginBottom: 12,
    },
    effortTitle: {
        color: colors.Text01,
        marginTop: 20,
        marginBottom: 4,
    },
    options: {
        flexDirection: 'row',
        marginBottom: 4,
    },
    effortOptions: {
        flexWrap: 'wrap',
    },
    option: {
        minWidth: 112,
        minHeight: 44,
        paddingHorizontal: 16,
        marginRight: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.Grey300,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
    },
    effortOption: {
        minWidth: 96,
        marginBottom: 8,
    },
    selectedOption: {
        borderColor: colors.Primary100,
        backgroundColor: colors.UtilityBlue100,
    },
    selectedLabel: {
        color: colors.Primary100,
    },
    spinner: {
        marginLeft: 8,
    },
    error: {
        ...styles.caption1,
        color: colors.UtilityRed200,
        marginTop: 8,
    },
    hint: {
        ...styles.caption1,
        color: colors.Text02,
        marginTop: -4,
        marginBottom: 4,
    },
})
