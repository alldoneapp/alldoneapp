import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import global, { colors } from '../../../styles/global'
import { TOOL_LABEL_BY_KEY } from '../../../AssistantDetailedView/Customizations/ToolsAccess/toolOptions'
import { translate } from '../../../../i18n/TranslationService'

export const ASSISTANT_PROGRESS_ROTATION_MS = 2800

const ACTIVITY_SEQUENCES = {
    preparing: [
        ['👀', 'assistant_progress_preparing_1'],
        ['🧠', 'assistant_progress_preparing_2'],
        ['🧭', 'assistant_progress_preparing_3'],
        ['✨', 'assistant_progress_preparing_4'],
    ],
    thinking: [
        ['🧠', 'assistant_progress_thinking_1'],
        ['🧭', 'assistant_progress_thinking_2'],
        ['🔍', 'assistant_progress_thinking_3'],
        ['✍️', 'assistant_progress_thinking_4'],
    ],
    web: [
        ['🔎', 'assistant_progress_web_1'],
        ['📚', 'assistant_progress_web_2'],
        ['🧭', 'assistant_progress_web_3'],
        ['🧹', 'assistant_progress_web_4'],
        ['✨', 'assistant_progress_web_5'],
    ],
    workspace: [
        ['🗂️', 'assistant_progress_workspace_1'],
        ['🔍', 'assistant_progress_workspace_2'],
        ['👀', 'assistant_progress_workspace_3'],
        ['🧩', 'assistant_progress_workspace_4'],
    ],
    communication: [
        ['📬', 'assistant_progress_communication_1'],
        ['🔍', 'assistant_progress_communication_2'],
        ['👀', 'assistant_progress_communication_3'],
        ['🧩', 'assistant_progress_communication_4'],
    ],
    change: [
        ['🛠️', 'assistant_progress_change_1'],
        ['🔍', 'assistant_progress_change_2'],
        ['✅', 'assistant_progress_change_3'],
        ['✨', 'assistant_progress_change_4'],
    ],
    specialist: [
        ['🤝', 'assistant_progress_specialist_1'],
        ['🧠', 'assistant_progress_specialist_2'],
        ['👀', 'assistant_progress_specialist_3'],
        ['✨', 'assistant_progress_specialist_4'],
    ],
    tool: [
        ['🧰', 'assistant_progress_tool_1'],
        ['⏳', 'assistant_progress_tool_2'],
        ['🔍', 'assistant_progress_tool_3'],
        ['🧩', 'assistant_progress_tool_4'],
    ],
    composing: [
        ['🧩', 'assistant_progress_composing_1'],
        ['✍️', 'assistant_progress_composing_2'],
        ['🔍', 'assistant_progress_composing_3'],
        ['✨', 'assistant_progress_composing_4'],
    ],
}

const normalizeToolName = toolName =>
    String(toolName || '')
        .trim()
        .toLowerCase()

const humanizeToolName = toolName => {
    const normalized = normalizeToolName(toolName)
    if (!normalized) return ''
    const words = normalized.replace(/[_-]+/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
}

export const getAssistantProgressToolLabel = toolName => {
    const normalized = normalizeToolName(toolName)
    if (!normalized) return ''

    const canonicalToolName = normalized === 'get_note' ? 'get_notes' : normalized
    const labelKey =
        TOOL_LABEL_BY_KEY[canonicalToolName] ||
        (normalized.startsWith('talk_to_assistant_') && TOOL_LABEL_BY_KEY.talk_to_assistant) ||
        (normalized.startsWith('external_tool_') && TOOL_LABEL_BY_KEY.external_tools) ||
        (normalized.startsWith('mcp_') && TOOL_LABEL_BY_KEY.mcp_servers)

    return labelKey ? translate(labelKey) : humanizeToolName(toolName)
}

export const getAssistantProgressKind = activity => {
    const phase = String(activity?.phase || '').toLowerCase()
    if (phase === 'preparing' || phase === 'thinking' || phase === 'composing') return phase
    if (phase !== 'tool') return 'preparing'

    const toolName = normalizeToolName(activity?.toolName)
    if (toolName === 'web_search' || toolName.includes('search_web')) return 'web'
    if (toolName.startsWith('talk_to_assistant_') || toolName === 'execute_task_in_vm') return 'specialist'
    if (/^(create|update|delete|archive|move|complete|restore|add|remove)_/.test(toolName)) return 'change'
    if (/(gmail|email|calendar|meeting|contact|whatsapp)/.test(toolName)) return 'communication'
    if (/(note|task|goal|project|focus|search)/.test(toolName)) return 'workspace'
    return 'tool'
}

export const getAssistantProgressSequence = activity => ACTIVITY_SEQUENCES[getAssistantProgressKind(activity)]

export default function AssistantProgress({
    activity = { phase: 'preparing' },
    compact = false,
    appearance = 'light',
}) {
    const sequence = useMemo(() => getAssistantProgressSequence(activity), [activity?.phase, activity?.toolName])
    const activityKey = `${activity?.phase || 'preparing'}:${activity?.toolName || ''}:${activity?.startedAt || ''}`
    const [stepIndex, setStepIndex] = useState(0)
    const darkAppearance = appearance === 'dark'

    useEffect(() => {
        setStepIndex(0)
        const interval = setInterval(() => {
            setStepIndex(current => Math.min(current + 1, sequence.length - 1))
        }, ASSISTANT_PROGRESS_ROTATION_MS)
        return () => clearInterval(interval)
    }, [activityKey, sequence.length])

    const visibleSteps = sequence.slice(Math.max(0, stepIndex - 2), stepIndex + 1)
    const footerKey = stepIndex >= 3 ? 'assistant_progress_reassurance_slow' : 'assistant_progress_reassurance'
    const activeToolLabel =
        normalizeToolName(activity?.phase) === 'tool' ? getAssistantProgressToolLabel(activity?.toolName) : ''
    const footerText = activeToolLabel
        ? `${translate('assistant_progress_using_tool')}: ${activeToolLabel}`
        : translate(footerKey)

    return (
        <View
            style={[
                localStyles.container,
                compact && localStyles.compactContainer,
                darkAppearance && localStyles.darkContainer,
            ]}
            testID="assistant-progress"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${translate(sequence[stepIndex][1])}. ${footerText}`}
        >
            <View style={localStyles.trail} testID="assistant-progress-trail">
                {visibleSteps.map(([emoji, textKey], index) => {
                    const isCurrent = index === visibleSteps.length - 1
                    return (
                        <View key={textKey} style={[localStyles.stepRow, !isCurrent && localStyles.previousStep]}>
                            <Text style={[localStyles.emoji, darkAppearance && localStyles.darkEmoji]}>
                                {isCurrent ? emoji : '•'}
                            </Text>
                            <Text
                                style={[
                                    localStyles.stepText,
                                    darkAppearance && localStyles.darkStepText,
                                    isCurrent && localStyles.currentStepText,
                                    isCurrent && darkAppearance && localStyles.darkCurrentStepText,
                                ]}
                                numberOfLines={1}
                                ellipsizeMode="tail"
                                testID="assistant-progress-step-text"
                            >
                                {translate(textKey)}
                            </Text>
                            {isCurrent && (
                                <ActivityIndicator
                                    style={localStyles.indicator}
                                    size="small"
                                    color={darkAppearance ? colors.UtilityBlue200 : colors.Primary100}
                                />
                            )}
                        </View>
                    )
                })}
            </View>
            <Text
                style={[localStyles.reassurance, darkAppearance && localStyles.darkReassurance]}
                numberOfLines={1}
                ellipsizeMode="tail"
                testID="assistant-progress-reassurance"
            >
                {footerText}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignSelf: 'flex-start',
        width: '100%',
        maxWidth: 440,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: colors.UtilityBlue100,
        borderWidth: 1,
        borderColor: colors.UtilityBlue125,
    },
    compactContainer: {
        marginTop: 4,
        paddingVertical: 8,
    },
    darkContainer: {
        backgroundColor: colors.Secondary300,
        borderColor: colors.Secondary200,
    },
    trail: {
        height: 72,
        justifyContent: 'flex-end',
        overflow: 'hidden',
    },
    stepRow: {
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
    },
    previousStep: {
        opacity: 0.58,
    },
    emoji: {
        width: 24,
        ...global.body2,
        color: colors.UtilityGreen300,
    },
    darkEmoji: {
        color: colors.ProjectColor100,
    },
    stepText: {
        flex: 1,
        ...global.body2,
        color: colors.Text02,
    },
    darkStepText: {
        color: colors.UtilityBlue150,
    },
    currentStepText: {
        ...global.subtitle2,
        color: colors.Text01,
    },
    darkCurrentStepText: {
        color: '#FFFFFF',
    },
    indicator: {
        marginLeft: 8,
        transform: [{ scale: 0.8 }],
    },
    reassurance: {
        ...global.caption2,
        color: colors.Text03,
        marginTop: 6,
        marginLeft: 24,
        height: 20,
    },
    darkReassurance: {
        color: colors.Text04,
    },
})
