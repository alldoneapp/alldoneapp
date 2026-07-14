import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { getVmAgentSettings, setDefaultVmAgent } from '../../../utils/backends/firestore'

const AGENTS = [
    { id: 'claude', label: 'Claude' },
    { id: 'codex', label: 'Codex' },
]

export default function DefaultVmAgentSection() {
    const [selectedAgent, setSelectedAgent] = useState(null)
    const [savingAgent, setSavingAgent] = useState(null)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true
        getVmAgentSettings()
            .then(settings => {
                if (mounted) setSelectedAgent(settings.effectiveDefaultAgent)
            })
            .catch(loadError => {
                if (mounted) setError(loadError?.message || translate('Could not load the default VM agent.'))
            })
        return () => {
            mounted = false
        }
    }, [])

    const selectAgent = async agent => {
        if (savingAgent || agent === selectedAgent) return

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

    return (
        <View style={localStyles.section}>
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
                            disabled={!!savingAgent || selectedAgent === null}
                            accessibilityRole="radio"
                            accessibilityState={{ selected, disabled: !!savingAgent || selectedAgent === null }}
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
            {selectedAgent === null && !error && <ActivityIndicator size="small" color={colors.Primary100} />}
            {!!error && <Text style={localStyles.error}>{error}</Text>}
        </View>
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
    options: {
        flexDirection: 'row',
        marginBottom: 4,
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
})
