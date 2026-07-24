import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Switch from '../../../UIControls/Switch'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import { translate } from '../../../../i18n/TranslationService'
import {
    getTaskPriorityLearning,
    resetTaskPriorityLearning,
    saveTaskPriorityLearning,
} from '../../../../utils/backends/TaskPriorityLearning/taskPriorityLearningFirestore'
import { TASK_PRIORITIZATION_SKILL_BODY } from '../../../../utils/AssistantSkills/builtInAssistantSkills'

const getMethodSummary = skill => {
    const body = typeof skill?.body === 'string' && skill.body.trim() ? skill.body : TASK_PRIORITIZATION_SKILL_BODY
    return body
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .slice(0, 8)
        .join('\n')
}

export default function TaskPriorityLearningOverlayModal({ skill, closeModal }) {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [enabled, setEnabled] = useState(true)
    const [learnedRules, setLearnedRules] = useState('')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true
        getTaskPriorityLearning()
            .then(data => {
                if (!mounted) return
                setEnabled(data.enabled !== false)
                setLearnedRules(data.learnedRules || '')
            })
            .catch(loadError => {
                if (!mounted) return
                setError(loadError.message || translate('Failed to load learned rules'))
            })
            .finally(() => {
                if (mounted) setLoading(false)
            })

        return () => {
            mounted = false
        }
    }, [])

    const save = async () => {
        setSaving(true)
        setError('')
        setMessage('')
        try {
            await saveTaskPriorityLearning({ enabled, learnedRules })
            setMessage(translate('Learned rules saved'))
        } catch (saveError) {
            setError(saveError.message || translate('Failed to save learned rules'))
        } finally {
            setSaving(false)
        }
    }

    const reset = async () => {
        setSaving(true)
        setError('')
        setMessage('')
        try {
            const data = await resetTaskPriorityLearning()
            setEnabled(data.enabled)
            setLearnedRules(data.learnedRules)
            setMessage(translate('Learned rules reset'))
        } catch (resetError) {
            setError(resetError.message || translate('Failed to reset learned rules'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <ModalHeader
                closeModal={closeModal}
                title={translate('Task prioritization overlay')}
                description={translate('Edit the personal rules your assistants apply when prioritizing tasks')}
            />

            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <View style={localStyles.card}>
                    <Text style={localStyles.cardTitle}>{translate('Global skill method')}</Text>
                    <Text style={localStyles.methodText}>{getMethodSummary(skill)}</Text>
                </View>

                <View style={localStyles.switchRow}>
                    <View style={localStyles.switchText}>
                        <Text style={localStyles.label}>{translate('Learning enabled')}</Text>
                        <Text style={localStyles.helperText}>
                            {translate('When enabled, feedback can update these private rules.')}
                        </Text>
                    </View>
                    <Switch
                        active={enabled}
                        activeSwitch={() => setEnabled(true)}
                        deactiveSwitch={() => setEnabled(false)}
                        disabled={loading || saving}
                    />
                </View>

                <Text style={localStyles.label}>{translate('Learned rules')}</Text>
                <TextInput
                    value={learnedRules}
                    onChangeText={setLearnedRules}
                    editable={!loading && !saving}
                    multiline
                    placeholder={translate('Example: Prefer client commitments before internal cleanup.')}
                    placeholderTextColor={colors.Text03}
                    style={localStyles.input}
                />
                <Text style={localStyles.helperText}>
                    {translate('These rules are private to you and do not change the global Alldone skill.')}
                </Text>

                {!!message && <Text style={localStyles.successText}>{message}</Text>}
                {!!error && <Text style={localStyles.errorText}>{error}</Text>}
            </CustomScrollView>

            <View style={localStyles.actions}>
                <Button type="ghost" onPress={reset} title={translate('Reset learned rules')} disabled={saving} />
                <View style={localStyles.actionSpacer} />
                <Button type="ghost" onPress={closeModal} title={translate('Close')} disabled={saving} />
                <Button type="primary" onPress={save} title={translate('Save')} disabled={saving || loading} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 560,
        maxWidth: 620,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        padding: 16,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        maxHeight: 480,
    },
    card: {
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey400,
        padding: 12,
        marginBottom: 16,
    },
    cardTitle: {
        ...styles.subtitle2,
        color: '#FFFFFF',
        marginBottom: 8,
    },
    methodText: {
        ...styles.body2,
        color: colors.Text03,
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    switchText: {
        flex: 1,
        paddingRight: 16,
    },
    label: {
        ...styles.subtitle2,
        color: '#FFFFFF',
        marginBottom: 6,
    },
    helperText: {
        ...styles.caption2,
        color: colors.Text03,
        marginBottom: 12,
    },
    input: {
        ...styles.body2,
        color: '#FFFFFF',
        minHeight: 160,
        textAlignVertical: 'top',
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey400,
        padding: 12,
        marginBottom: 8,
    },
    successText: {
        ...styles.caption1,
        color: colors.UtilityGreen200,
        marginTop: 8,
    },
    errorText: {
        ...styles.caption1,
        color: colors.UtilityRed200,
        marginTop: 8,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginTop: 16,
    },
    actionSpacer: {
        flex: 1,
    },
})
