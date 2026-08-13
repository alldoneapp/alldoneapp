import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

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
const OPENROUTER_PREFIX = 'openrouter:'
const OPENAI_SOURCE = 'openai'
const OPENROUTER_SOURCE = 'openrouter'
const OPENROUTER_SEARCH_RESULT_LIMIT = 40

// Codex speaks an OpenAI-compatible protocol, so it can also run tool-calling OpenRouter models
// (DeepSeek and friends). The source is encoded into the stored value with an `openrouter:` prefix
// — see functions/Assistant/vmModelRouting.js — so this screen never needs a second saved field.
function isOpenRouterSelection(value) {
    return typeof value === 'string' && value.startsWith(OPENROUTER_PREFIX)
}

// The picker offers families ("Opus", "Sol"), never concrete versions — the family is resolved
// to its newest release when the VM task actually starts. See functions/Assistant/vmAgentModelCatalog.js.
// For OpenRouter it offers concrete models, because an OpenRouter id is already a vendor-maintained
// pointer at the current release of that line.
function familiesForAgent(modelCatalogs, agent, source = OPENAI_SOURCE) {
    const key = agent === 'codex' && source === OPENROUTER_SOURCE ? OPENROUTER_SOURCE : agent
    const catalog = modelCatalogs && key ? modelCatalogs[key] : null
    return catalog && Array.isArray(catalog.families) ? catalog.families : []
}

function searchableOpenRouterModels(catalog) {
    if (catalog && Array.isArray(catalog.searchModels)) return catalog.searchModels
    return catalog && Array.isArray(catalog.families) ? catalog.families : []
}

function searchOpenRouterModels(models, query) {
    const terms = String(query || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    if (!terms.length) return models

    return models.filter(model => {
        const searchable = [model.label, model.modelId, model.vendor, model.id].filter(Boolean).join(' ').toLowerCase()
        return terms.every(term => searchable.includes(term))
    })
}

// The toggle is only meaningful for Codex, and only when the environment can actually reach
// OpenRouter — offering a model whose run would fail closed is worse than not offering it.
function isOpenRouterAvailable(modelCatalogs) {
    const catalog = modelCatalogs ? modelCatalogs[OPENROUTER_SOURCE] : null
    return !!catalog && catalog.available !== false && Array.isArray(catalog.families) && catalog.families.length > 0
}

const MODEL_SOURCES = [
    { id: OPENAI_SOURCE, label: 'OpenAI' },
    { id: OPENROUTER_SOURCE, label: 'OpenRouter' },
]

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
    // Which source the Codex model list is showing. Initialised from the saved choice so a user
    // who picked DeepSeek returns to the OpenRouter list rather than to an OpenAI list that makes
    // their selection look lost.
    const [modelSource, setModelSource] = useState(OPENAI_SOURCE)
    const [modelSearch, setModelSearch] = useState('')

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
                    const savedCodex = (settings.defaultModelFamilies && settings.defaultModelFamilies.codex) || null
                    setSelectedFamilies({
                        claude: (settings.defaultModelFamilies && settings.defaultModelFamilies.claude) || null,
                        codex: savedCodex,
                    })
                    setModelSource(isOpenRouterSelection(savedCodex) ? OPENROUTER_SOURCE : OPENAI_SOURCE)
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
        setModelSearch('')
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
    const showModelSources = selectedAgent === 'codex' && isOpenRouterAvailable(modelCatalogs)
    const activeModelSource = showModelSources ? modelSource : OPENAI_SOURCE
    const activeCatalog =
        modelCatalogs && selectedAgent
            ? modelCatalogs[activeModelSource === OPENROUTER_SOURCE ? OPENROUTER_SOURCE : selectedAgent]
            : null
    const featuredModelOptions = familiesForAgent(modelCatalogs, selectedAgent, activeModelSource)
    const isOpenRouterSource = activeModelSource === OPENROUTER_SOURCE
    const normalizedModelSearch = modelSearch.trim()
    const hasModelSearch = normalizedModelSearch.length > 0
    const allOpenRouterModels = isOpenRouterSource ? searchableOpenRouterModels(activeCatalog) : []
    const openRouterMatches = isOpenRouterSource
        ? searchOpenRouterModels(allOpenRouterModels, normalizedModelSearch)
        : []
    let modelOptions = featuredModelOptions
    if (isOpenRouterSource && hasModelSearch) {
        modelOptions = openRouterMatches.slice(0, OPENROUTER_SEARCH_RESULT_LIMIT)
    } else if (isOpenRouterSource) {
        // A previously selected niche model should never look lost merely because it is not one of
        // today's featured models. Keep it beside the featured set until the user chooses another.
        const selectedModel = allOpenRouterModels.find(model => model.id === selectedFamilies.codex)
        if (selectedModel && !modelOptions.some(model => model.id === selectedModel.id)) {
            modelOptions = [...modelOptions, selectedModel]
        }
    }
    const searchResultsTruncated =
        isOpenRouterSource && hasModelSearch && openRouterMatches.length > OPENROUTER_SEARCH_RESULT_LIMIT

    // Switching the source only changes what the list shows; it never saves. The saved value is
    // whatever model the user last picked, and it stays selected while they browse the other list.
    const selectSource = source => {
        if (agentControlsDisabled || source === modelSource) return
        setModelSource(source)
        setModelSearch('')
    }

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
            {showModelSources && (
                <View style={[localStyles.options, localStyles.sourceOptions]}>
                    {MODEL_SOURCES.map(source => {
                        const selected = activeModelSource === source.id
                        return (
                            <TouchableOpacity
                                key={source.id}
                                style={[
                                    localStyles.option,
                                    localStyles.sourceOption,
                                    selected && localStyles.selectedOption,
                                ]}
                                onPress={() => selectSource(source.id)}
                                disabled={agentControlsDisabled}
                                accessibilityRole="radio"
                                accessibilityState={{ selected, disabled: agentControlsDisabled }}
                            >
                                <Text style={[styles.subtitle2, selected && localStyles.selectedLabel]}>
                                    {source.label}
                                </Text>
                            </TouchableOpacity>
                        )
                    })}
                </View>
            )}
            {loaded && isOpenRouterSource && (
                <TextInput
                    testID="openrouter-model-search"
                    value={modelSearch}
                    onChangeText={setModelSearch}
                    style={[styles.body2, localStyles.modelSearch]}
                    placeholder={translate('Search all OpenRouter models')}
                    placeholderTextColor={colors.Text03}
                    accessibilityLabel={translate('Search OpenRouter models')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!agentControlsDisabled}
                    numberOfLines={1}
                />
            )}
            {loaded && isOpenRouterSource && (
                <Text style={localStyles.modelListLabel}>
                    {translate(hasModelSearch ? 'Search results' : 'Featured models')}
                </Text>
            )}
            <View style={[localStyles.options, localStyles.effortOptions]}>
                {[{ id: null, key: NO_MODEL_DEFAULT_KEY, label: translate('No default') }]
                    .concat(
                        modelOptions.map(family => ({
                            id: family.id,
                            key: family.id,
                            // Provider-supplied names ("Opus", "Sol", "DeepSeek V3.2") are proper
                            // nouns, not translatable UI strings — render them as discovered.
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
            {loaded && isOpenRouterSource && hasModelSearch && modelOptions.length === 0 && (
                <Text style={localStyles.emptySearch}>{translate('No compatible models match your search.')}</Text>
            )}
            {searchResultsTruncated && (
                <Text style={localStyles.hint}>
                    {translate('Showing the first 40 matches. Refine your search to narrow the list.')}
                </Text>
            )}
            {loaded && activeCatalog?.source === 'fallback' && (
                <Text style={localStyles.hint}>
                    {translate('Could not reach the model provider, so a built-in list of families is shown.')}
                </Text>
            )}
            {loaded && activeModelSource === OPENROUTER_SOURCE && (
                <Text style={localStyles.hint}>
                    {translate(
                        'OpenRouter models run through the Codex harness but authenticate separately: they use the OpenRouter route in AI agent authentication below — your own OpenRouter API key, or Alldone Gold. Your Claude or ChatGPT subscription and your OpenAI key do not apply to them.'
                    )}
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
    sourceOptions: {
        marginBottom: 8,
    },
    sourceOption: {
        minWidth: 96,
        minHeight: 36,
    },
    modelSearch: {
        width: '100%',
        maxWidth: 520,
        height: 40,
        color: colors.Text01,
        borderWidth: 1,
        borderRadius: 6,
        borderColor: colors.Gray400,
        paddingHorizontal: 12,
        marginBottom: 8,
    },
    modelListLabel: {
        ...styles.caption1,
        color: colors.Text02,
        marginBottom: 6,
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
    emptySearch: {
        ...styles.caption1,
        color: colors.Text02,
        marginTop: -2,
        marginBottom: 8,
    },
})
