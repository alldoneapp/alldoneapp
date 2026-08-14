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

/**
 * Emoji per activity key. The key itself and its already-sanitized subject are produced
 * server-side (functions/Assistant/assistantToolActivity.js) and travel on
 * `assistantRun.activity`; an unmapped key simply falls back to the kind's emoji, so
 * adding a key on the server can never break rendering here.
 */
export const ACTION_EMOJI = {
    assistant_activity_search_notes: '🔍',
    assistant_activity_search_tasks: '🔍',
    assistant_activity_search_goals: '🔍',
    assistant_activity_search_contacts: '🔍',
    assistant_activity_search_chats: '🔍',
    assistant_activity_search_assistants: '🔍',
    assistant_activity_search_workspace: '🔍',
    assistant_activity_search_workspace_plain: '🗂️',
    assistant_activity_search_web: '🔎',
    assistant_activity_search_web_plain: '🔎',
    assistant_activity_search_email: '📬',
    assistant_activity_search_email_plain: '📬',
    assistant_activity_search_calendar: '📅',
    assistant_activity_search_calendar_plain: '📅',
    assistant_activity_read_notes: '🗂️',
    assistant_activity_read_tasks: '✅',
    assistant_activity_read_goals: '🎯',
    assistant_activity_read_contacts: '👥',
    assistant_activity_read_chats: '💬',
    assistant_activity_read_updates: '📰',
    assistant_activity_read_focus: '🎯',
    assistant_activity_read_projects: '🗂️',
    assistant_activity_read_okrs: '🎯',
    assistant_activity_read_happiness: '😊',
    assistant_activity_create_task: '✅',
    assistant_activity_create_task_plain: '✅',
    assistant_activity_update_task: '✏️',
    assistant_activity_update_task_plain: '✏️',
    assistant_activity_create_note: '📝',
    assistant_activity_create_note_plain: '📝',
    assistant_activity_update_note: '✏️',
    assistant_activity_update_note_plain: '✏️',
    assistant_activity_update_contact: '👤',
    assistant_activity_update_contact_plain: '👤',
    assistant_activity_add_comment: '💬',
    assistant_activity_update_memory: '🧠',
    assistant_activity_compact_context: '🧹',
    assistant_activity_create_event: '📅',
    assistant_activity_create_event_plain: '📅',
    assistant_activity_update_event: '📅',
    assistant_activity_update_event_plain: '📅',
    assistant_activity_delete_event: '🗑️',
    assistant_activity_find_availability: '📅',
    assistant_activity_draft_email: '✉️',
    assistant_activity_update_draft: '✉️',
    assistant_activity_organize_email: '📬',
    assistant_activity_check_weather: '🌦️',
    assistant_activity_check_weather_plain: '🌦️',
    assistant_activity_plan_route: '🗺️',
    assistant_activity_plan_route_plain: '🗺️',
    assistant_activity_find_places: '📍',
    assistant_activity_find_places_plain: '📍',
    assistant_activity_load_skill: '📚',
    assistant_activity_load_skill_plain: '📚',
    assistant_activity_vm_task: '🤝',
    assistant_activity_vm_task_plain: '🤝',
    assistant_activity_ask_assistant: '🤝',
    assistant_activity_ask_assistant_plain: '🤝',
}

// Defensive cap: the server truncates to 48 characters, but a subject that predates the
// current sanitizer (or an unexpectedly long one) must not blow up the single-line row.
const MAX_RENDERED_SUBJECT_LENGTH = 60

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

/**
 * The specific, human-readable line for a running tool call — "Searching notes for
 * “Pricing”". Returns null when the run carries no safe detail (no whitelist rule for
 * the tool, an unrecognised key, or a subject the server refused to expose), in which
 * case the caller keeps the generic rotating story.
 */
export const getAssistantProgressDetail = activity => {
    if (normalizeToolName(activity?.phase) !== 'tool') return null

    const actionKey = String(activity?.actionKey || '').trim()
    const emoji = ACTION_EMOJI[actionKey]
    if (!emoji) return null

    const rawSubject = typeof activity?.subject === 'string' ? activity.subject.replace(/\s+/g, ' ').trim() : ''
    const subject =
        rawSubject.length > MAX_RENDERED_SUBJECT_LENGTH
            ? `${rawSubject.slice(0, MAX_RENDERED_SUBJECT_LENGTH).trim()}…`
            : rawSubject

    const text = translate(actionKey, subject ? { subject } : {})

    // A subject-taking phrase rendered without a subject leaves an unresolved
    // placeholder; fall back rather than show it.
    if (!text || text.includes('%{') || /\bmissing\b/i.test(text)) return null

    return { emoji, text }
}

export default function AssistantProgress({
    activity = { phase: 'preparing' },
    compact = false,
    appearance = 'light',
}) {
    const sequence = useMemo(() => getAssistantProgressSequence(activity), [activity?.phase, activity?.toolName])
    const detail = useMemo(
        () => getAssistantProgressDetail(activity),
        [activity?.phase, activity?.actionKey, activity?.subject]
    )
    const activityKey = `${activity?.phase || 'preparing'}:${activity?.toolName || ''}:${activity?.actionKey || ''}:${
        activity?.subject || ''
    }:${activity?.startedAt || ''}`
    const [stepIndex, setStepIndex] = useState(0)
    const darkAppearance = appearance === 'dark'

    useEffect(() => {
        setStepIndex(0)
        const interval = setInterval(() => {
            setStepIndex(current => Math.min(current + 1, sequence.length - 1))
        }, ASSISTANT_PROGRESS_ROTATION_MS)
        return () => clearInterval(interval)
    }, [activityKey, sequence.length])

    // With a specific detail there is nothing to rotate: the one line that says what is
    // actually happening stays pinned for the whole tool call, and the footer goes back
    // to plain reassurance instead of naming the tool.
    const visibleSteps = detail
        ? [[detail.emoji, detail.text, true]]
        : sequence.slice(Math.max(0, stepIndex - 2), stepIndex + 1).map(([emoji, textKey]) => [emoji, textKey, false])

    const footerKey = stepIndex >= 3 ? 'assistant_progress_reassurance_slow' : 'assistant_progress_reassurance'
    const activeToolLabel =
        !detail && normalizeToolName(activity?.phase) === 'tool'
            ? getAssistantProgressToolLabel(activity?.toolName)
            : ''
    const footerText = activeToolLabel
        ? `${translate('assistant_progress_using_tool')}: ${activeToolLabel}`
        : translate(footerKey)
    const currentStepText = detail ? detail.text : translate(sequence[stepIndex][1])

    return (
        <View
            style={[
                localStyles.container,
                compact && localStyles.compactContainer,
                darkAppearance && localStyles.darkContainer,
            ]}
            testID="assistant-progress"
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${currentStepText}. ${footerText}`}
        >
            <View style={localStyles.trail} testID="assistant-progress-trail">
                {visibleSteps.map(([emoji, textKey, isLiteralText], index) => {
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
                                {isLiteralText ? textKey : translate(textKey)}
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
