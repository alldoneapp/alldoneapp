import React, { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import global, { colors } from '../../../styles/global'
import { respondToVmInteraction } from '../../../../utils/backends/Assistants/assistantRuns'

function ActionButton({ label, onPress, disabled, secondary, danger }) {
    return (
        <TouchableOpacity
            style={[
                styles.button,
                secondary && styles.secondaryButton,
                danger && styles.dangerButton,
                disabled && styles.disabled,
            ]}
            onPress={onPress}
            disabled={disabled}
        >
            <Text
                style={[styles.buttonText, secondary && styles.secondaryButtonText, danger && styles.dangerButtonText]}
            >
                {label}
            </Text>
        </TouchableOpacity>
    )
}

export default function VmInteractionCard({ projectId, objectType, objectId, commentId, assistantRun }) {
    const interaction = assistantRun?.interaction
    const [answers, setAnswers] = useState({})
    const [message, setMessage] = useState('')
    const [revising, setRevising] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')

    const questions = useMemo(() => interaction?.questions || [], [interaction?.questions])
    if (!interaction?.requestId || !assistantRun?.runId) return null

    const submit = async action => {
        if (submitting) return
        setSubmitting(true)
        setError('')
        try {
            await respondToVmInteraction({
                projectId,
                objectType,
                objectId,
                commentId,
                runId: assistantRun.runId,
                requestId: interaction.requestId,
                response: { action, answers, message },
            })
        } catch (submitError) {
            setSubmitting(false)
            setError(submitError.message || 'Could not send your response.')
        }
    }

    const toggleOption = (question, label) => {
        const current = Array.isArray(answers[question.id]) ? answers[question.id] : []
        const next = question.multiSelect
            ? current.includes(label)
                ? current.filter(value => value !== label)
                : [...current, label]
            : [label]
        setAnswers({ ...answers, [question.id]: next })
    }

    return (
        <View style={styles.card}>
            <Text style={styles.eyebrow}>
                {interaction.kind === 'plan_review'
                    ? 'PLAN READY'
                    : interaction.kind === 'tool_approval'
                    ? 'APPROVAL REQUIRED'
                    : 'QUESTION'}
            </Text>

            {interaction.kind === 'plan_review' && (
                <>
                    <Text style={styles.plan}>{interaction.plan}</Text>
                    {revising && (
                        <TextInput
                            value={message}
                            onChangeText={setMessage}
                            placeholder="What should change in the plan?"
                            placeholderTextColor={colors.Text03}
                            multiline={true}
                            style={styles.input}
                        />
                    )}
                    <View style={styles.actions}>
                        <ActionButton label="Execute plan" onPress={() => submit('approve')} disabled={submitting} />
                        <ActionButton
                            label={revising ? 'Send changes' : 'Request changes'}
                            onPress={() => (revising ? submit('revise') : setRevising(true))}
                            disabled={submitting || (revising && !message.trim())}
                            secondary={true}
                        />
                        <ActionButton
                            label="Cancel"
                            onPress={() => submit('cancel')}
                            disabled={submitting}
                            danger={true}
                        />
                    </View>
                </>
            )}

            {interaction.kind === 'clarification' && (
                <>
                    {questions.map(question => (
                        <View key={question.id} style={styles.question}>
                            <Text style={styles.questionHeader}>{question.header}</Text>
                            <Text style={styles.questionText}>{question.question}</Text>
                            {(question.options || []).map(option => {
                                const selected = (answers[question.id] || []).includes(option.label)
                                return (
                                    <TouchableOpacity
                                        key={option.label}
                                        style={[styles.option, selected && styles.optionSelected]}
                                        onPress={() => toggleOption(question, option.label)}
                                        disabled={submitting}
                                    >
                                        <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                                            {option.label}
                                        </Text>
                                        {!!option.description && (
                                            <Text style={styles.optionDescription}>{option.description}</Text>
                                        )}
                                    </TouchableOpacity>
                                )
                            })}
                            {question.isOther !== false && (
                                <TextInput
                                    value={
                                        typeof answers[`${question.id}:other`] === 'string'
                                            ? answers[`${question.id}:other`]
                                            : ''
                                    }
                                    onChangeText={value => setAnswers({ ...answers, [`${question.id}:other`]: value })}
                                    placeholder="Type another answer…"
                                    placeholderTextColor={colors.Text03}
                                    secureTextEntry={!!question.isSecret}
                                    multiline={!question.isSecret}
                                    style={styles.input}
                                />
                            )}
                        </View>
                    ))}
                    <View style={styles.actions}>
                        <ActionButton label="Send answers" onPress={() => submit('submit')} disabled={submitting} />
                        <ActionButton
                            label="Cancel"
                            onPress={() => submit('cancel')}
                            disabled={submitting}
                            danger={true}
                        />
                    </View>
                </>
            )}

            {interaction.kind === 'tool_approval' && (
                <>
                    <Text style={styles.questionHeader}>{interaction.toolName}</Text>
                    {!!interaction.reason && <Text style={styles.questionText}>{interaction.reason}</Text>}
                    {!!interaction.command && <Text style={styles.command}>{interaction.command}</Text>}
                    {!!interaction.cwd && <Text style={styles.cwd}>in {interaction.cwd}</Text>}
                    <TextInput
                        value={message}
                        onChangeText={setMessage}
                        placeholder="Optional instruction or reason…"
                        placeholderTextColor={colors.Text03}
                        multiline={true}
                        style={styles.input}
                    />
                    <View style={styles.actions}>
                        <ActionButton label="Allow once" onPress={() => submit('approve')} disabled={submitting} />
                        <ActionButton
                            label="Deny"
                            onPress={() => submit('deny')}
                            disabled={submitting}
                            secondary={true}
                        />
                        <ActionButton
                            label="Cancel task"
                            onPress={() => submit('cancel')}
                            disabled={submitting}
                            danger={true}
                        />
                    </View>
                </>
            )}

            {submitting && <ActivityIndicator size="small" color={colors.Primary100} style={styles.spinner} />}
            {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
    )
}

const styles = StyleSheet.create({
    card: {
        maxWidth: 720,
        marginTop: 8,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.Gray300,
        borderRadius: 8,
        backgroundColor: colors.Grey100,
    },
    eyebrow: { ...global.caption2, color: colors.Primary100, fontWeight: '700', marginBottom: 10 },
    plan: { ...global.body1, color: colors.Text02 },
    question: { marginBottom: 14 },
    questionHeader: { ...global.subtitle2, color: colors.Text01, marginBottom: 4 },
    questionText: { ...global.body1, color: colors.Text02, marginBottom: 8 },
    option: { borderWidth: 1, borderColor: colors.Gray300, borderRadius: 6, padding: 10, marginBottom: 6 },
    optionSelected: { borderColor: colors.Primary100, backgroundColor: colors.UtilityBlue100 },
    optionLabel: { ...global.body2, color: colors.Text02, fontWeight: '500' },
    optionLabelSelected: { color: colors.Primary300 },
    optionDescription: { ...global.caption2, color: colors.Text03, marginTop: 2 },
    input: {
        ...global.body1,
        color: colors.Text02,
        minHeight: 44,
        padding: 10,
        marginTop: 8,
        borderWidth: 1,
        borderColor: colors.Gray300,
        borderRadius: 6,
        backgroundColor: '#FFFFFF',
        textAlignVertical: 'top',
    },
    command: {
        fontFamily: 'monospace',
        fontSize: 13,
        lineHeight: 20,
        color: colors.Text01,
        backgroundColor: colors.Grey200,
        padding: 10,
        borderRadius: 4,
    },
    cwd: { ...global.caption2, color: colors.Text03, marginTop: 4 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
    button: {
        minHeight: 32,
        justifyContent: 'center',
        paddingHorizontal: 12,
        marginRight: 8,
        marginBottom: 6,
        borderWidth: 1,
        borderColor: colors.Primary100,
        borderRadius: 5,
        backgroundColor: colors.Primary100,
    },
    secondaryButton: { backgroundColor: '#FFFFFF' },
    dangerButton: { backgroundColor: '#FFFFFF', borderColor: colors.UtilityRed200 },
    disabled: { opacity: 0.5 },
    buttonText: { ...global.caption2, color: '#FFFFFF', fontWeight: '600' },
    secondaryButtonText: { color: colors.Primary100 },
    dangerButtonText: { color: colors.UtilityRed200 },
    spinner: { alignSelf: 'flex-start', marginTop: 6 },
    error: { ...global.caption2, color: colors.UtilityRed200, marginTop: 6 },
})
