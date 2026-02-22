import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import DelegationDescriptionWrapper from './DelegationDescriptionWrapper'
import { getAssistantDelegationDescriptionStatus } from '../../../../utils/backends/Assistants/assistantsFirestore'

export default function DelegationDescriptionProperty({ disabled, projectId, assistant }) {
    const [status, setStatus] = useState({
        loading: true,
        delegationToolDescriptionManual: '',
        effectiveDescription: '',
        effectiveSource: 'assistant_description_fallback',
        isStale: false,
    })

    const refreshStatus = useCallback(async () => {
        try {
            const result = await getAssistantDelegationDescriptionStatus(projectId, assistant.uid)
            setStatus({
                loading: false,
                delegationToolDescriptionManual: result?.delegationToolDescriptionManual || '',
                effectiveDescription: result?.effectiveDescription || '',
                effectiveSource: result?.effectiveSource || 'assistant_description_fallback',
                isStale: !!result?.isStale,
            })
        } catch (error) {
            console.error('Error loading delegation description status:', error)
            setStatus(prev => ({
                ...prev,
                loading: false,
            }))
        }
    }, [projectId, assistant.uid])

    useEffect(() => {
        refreshStatus()
    }, [refreshStatus, assistant.lastEditionDate])

    const sourceText = useMemo(() => {
        if (status.effectiveSource === 'manual') return translate('Manual')
        return translate('Assistant description fallback')
    }, [status.effectiveSource])

    const activeDescription = status.effectiveDescription || assistant.description || ''

    const summaryText = status.loading
        ? translate('Loading')
        : activeDescription || translate('No delegation description configured')

    return (
        <View style={localStyles.container}>
            <Icon name="tool" size={24} color={colors.Text03} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <Text style={localStyles.text}>{translate('Delegation tool description')}</Text>
                <Text style={localStyles.summary} numberOfLines={1}>
                    {summaryText}
                </Text>
                {!status.loading && (
                    <Text style={localStyles.badgeText}>
                        {translate('Source')}: {sourceText}
                    </Text>
                )}
                {!status.loading && status.isStale && (
                    <Text style={localStyles.staleText}>{translate('Delegation description stale hint')}</Text>
                )}
            </View>
            <View style={{ marginLeft: 'auto' }}>
                <DelegationDescriptionWrapper
                    disabled={disabled}
                    projectId={projectId}
                    assistant={assistant}
                    status={status}
                    onUpdated={refreshStatus}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        minHeight: 56,
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
    badgeText: {
        ...styles.caption,
        color: colors.Text03,
        marginTop: 2,
    },
    staleText: {
        ...styles.caption,
        color: '#F5C26B',
        marginTop: 2,
    },
})
