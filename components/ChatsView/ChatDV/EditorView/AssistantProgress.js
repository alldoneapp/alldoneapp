import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'

import global, { colors } from '../../../styles/global'
import { TOOL_LABEL_BY_KEY } from '../../../AssistantDetailedView/Customizations/ToolsAccess/toolOptions'
import { translate } from '../../../../i18n/TranslationService'
import AssistantThinking3D, { useAssistantThinking3DEnabled } from './AssistantThinking3D/AssistantThinking3D'

import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { appendAssistantActivity, getAssistantActivityKey } from '../../../../functions/shared/assistantActivityHistory'

const EMPTY_HISTORY = []
const PREPARING_ACTIVITY = { phase: 'preparing' }
const ACTIVITY_LABELS = {
    preparing: ['👀', 'assistant_progress_preparing_1'],
    thinking: ['🧠', 'assistant_progress_thinking_1'],
    web: ['🔎', 'assistant_progress_web_1'],
    workspace: ['🗂️', 'assistant_progress_workspace_1'],
    communication: ['📬', 'assistant_progress_communication_1'],
    change: ['🛠️', 'assistant_progress_change_1'],
    specialist: ['🤝', 'assistant_progress_specialist_1'],
    tool: ['🧰', 'assistant_progress_tool_1'],
    composing: ['🧩', 'assistant_progress_composing_1'],
}

/**
 * Emoji per activity key. The key itself and its already-sanitized subject are produced
 * server-side (functions/Assistant/assistantToolActivity.js) and travel on
 * `assistantRun.activity`; an unmapped key simply falls back to the kind's emoji, so
 * adding a key on the server can never break rendering here.
 */
export const ACTION_EMOJI = {
    assistant_activity_multiple_steps: '🧩',
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
    assistant_activity_browser_navigate: '🌐',
    assistant_activity_browser_inspect: '👀',
    assistant_activity_browser_click: '🖱️',
    assistant_activity_browser_type: '⌨️',
    assistant_activity_browser_wait: '⏳',
    assistant_activity_browser_screenshot: '📸',
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

/**
 * The specific, human-readable line for a running tool call — "Searching notes for
 * “Pricing”". Returns null when the run carries no safe detail (no whitelist rule for
 * the tool, an unrecognised key, or a subject the server refused to expose), in which
 * case the caller uses a stable phase or tool label.
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

const describeActivity = activity => {
    const detail = getAssistantProgressDetail(activity)
    if (detail) return detail
    const [emoji, textKey] = ACTIVITY_LABELS[getAssistantProgressKind(activity)]
    const toolLabel = activity?.phase === 'tool' && getAssistantProgressToolLabel(activity?.toolName)
    return { emoji, text: toolLabel || translate(textKey) }
}

export default function AssistantProgress({
    activity = PREPARING_ACTIVITY,
    activityHistory = EMPTY_HISTORY,
    runId,
    compact = false,
    appearance = 'light',
}) {
    const scrollRef = useRef(null)
    const reducedMotion = useReducedMotion()
    const darkAppearance = appearance === 'dark'
    const indicatorColor = darkAppearance ? colors.UtilityBlue200 : colors.Primary100
    const show3D = useAssistantThinking3DEnabled()
    const incoming = appendAssistantActivity(activityHistory, activity || PREPARING_ACTIVITY)
    const signature = JSON.stringify([runId, incoming])
    const [observed, setObserved] = useState({ runId, signature, entries: incoming })

    // Persisted history restores missed events after reopening. Older servers still
    // get a live trail from observed snapshots. Reset before paint when a run changes.
    let entries = observed.entries
    if (observed.signature !== signature) {
        entries = activityHistory?.length
            ? incoming
            : appendAssistantActivity(observed.runId === runId ? observed.entries : [], activity || PREPARING_ACTIVITY)
        setObserved({ runId, signature, entries })
    }
    const currentStepText = describeActivity(entries[entries.length - 1]).text
    const scrollToLatest = () => scrollRef.current?.scrollToEnd({ animated: !reducedMotion })
    const latestKey = getAssistantActivityKey(entries[entries.length - 1])
    useEffect(() => {
        scrollRef.current?.scrollToEnd({ animated: !reducedMotion })
    }, [latestKey, reducedMotion])

    return (
        <View
            style={[
                localStyles.container,
                compact && localStyles.compactContainer,
                darkAppearance && localStyles.darkContainer,
            ]}
            testID="assistant-progress"
        >
            <View style={localStyles.header}>
                <View style={[localStyles.liveDot, darkAppearance && localStyles.darkLiveDot]} />
                <Text style={[localStyles.heading, darkAppearance && localStyles.darkHeading]}>
                    {translate('assistant_progress_live_activity')}
                </Text>
                <View style={localStyles.stage}>
                    {show3D ? (
                        <AssistantThinking3D appearance={appearance} spinnerColor={indicatorColor} size={32} />
                    ) : (
                        <ActivityIndicator size="small" color={indicatorColor} />
                    )}
                </View>
            </View>
            <ScrollView
                ref={scrollRef}
                style={localStyles.trail}
                contentContainerStyle={localStyles.trailContent}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={scrollToLatest}
                onLayout={scrollToLatest}
                testID="assistant-progress-trail"
            >
                {entries.map((entry, index) => {
                    const isCurrent = index === entries.length - 1
                    const { emoji, text } = describeActivity(entry)
                    return (
                        <View
                            key={getAssistantActivityKey(entry)}
                            style={[
                                localStyles.stepRow,
                                isCurrent && localStyles.currentStep,
                                isCurrent && darkAppearance && localStyles.darkCurrentStep,
                                !isCurrent && localStyles.previousStep,
                                index < entries.length - 2 && localStyles.olderStep,
                                isCurrent && !reducedMotion && localStyles.arrivingStep,
                            ]}
                            testID={isCurrent ? 'assistant-progress-current' : 'assistant-progress-previous'}
                        >
                            <View style={localStyles.marker}>
                                {!isCurrent && (
                                    <View
                                        style={[localStyles.connector, darkAppearance && localStyles.darkConnector]}
                                    />
                                )}
                                <Text style={localStyles.emoji}>{emoji}</Text>
                            </View>
                            <Text
                                style={[
                                    localStyles.stepText,
                                    darkAppearance && localStyles.darkStepText,
                                    isCurrent && localStyles.currentStepText,
                                    isCurrent && darkAppearance && localStyles.darkCurrentStepText,
                                ]}
                                numberOfLines={isCurrent ? 2 : 1}
                                ellipsizeMode="tail"
                                testID="assistant-progress-step-text"
                                accessibilityLiveRegion={isCurrent ? 'polite' : 'none'}
                                accessibilityLabel={isCurrent ? currentStepText : undefined}
                            >
                                {text}
                            </Text>
                        </View>
                    )
                })}
            </ScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignSelf: 'flex-start',
        width: '100%',
        padding: 10,
        borderRadius: 12,
        backgroundColor: '#F4F7FF',
        borderWidth: 1,
        borderColor: '#DFE7FA',
        overflow: 'hidden',
    },
    compactContainer: { marginTop: 4 },
    darkContainer: {
        backgroundColor: colors.Secondary300,
        borderColor: colors.Secondary200,
    },
    header: {
        height: 28,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 9,
        marginBottom: 4,
    },
    liveDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: colors.Primary100,
        marginRight: 7,
    },
    darkLiveDot: { backgroundColor: colors.UtilityBlue200 },
    heading: {
        ...global.caption2,
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        color: '#60739A',
        flex: 1,
    },
    darkHeading: { color: colors.UtilityBlue150 },
    stage: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    trail: { maxHeight: 132, flexGrow: 0 },
    trailContent: { paddingTop: 2 },
    stepRow: {
        minHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        borderLeftWidth: 2,
        borderLeftColor: 'transparent',
    },
    currentStep: {
        minHeight: 44,
        paddingVertical: 7,
        marginTop: 3,
        borderRadius: 7,
        borderLeftColor: colors.Primary100,
        backgroundColor: '#FFFFFF',
    },
    darkCurrentStep: { backgroundColor: 'rgba(138, 163, 255, 0.12)', borderLeftColor: colors.UtilityBlue200 },
    previousStep: { opacity: 0.8 },
    olderStep: { opacity: 0.58 },
    marker: { width: 26, alignSelf: 'stretch', justifyContent: 'center' },
    connector: {
        position: 'absolute',
        width: 1,
        backgroundColor: '#D7DFEE',
        left: 7,
        top: 22,
        bottom: -4,
    },
    darkConnector: { backgroundColor: colors.Secondary200 },
    emoji: { fontSize: 13, lineHeight: 20 },
    stepText: { flex: 1, minWidth: 0, ...global.body2, fontSize: 12, color: colors.Text02 },
    darkStepText: { color: colors.UtilityBlue150 },
    currentStepText: { ...global.subtitle2, fontSize: 13, lineHeight: 20, color: colors.Text01 },
    darkCurrentStepText: { color: '#FFFFFF' },
    arrivingStep: Platform.select({
        web: {
            animationKeyframes: {
                from: { opacity: 0, transform: 'translateY(6px)' },
                to: { opacity: 1, transform: 'translateY(0)' },
            },
            animationDuration: '240ms',
            animationTimingFunction: 'ease-out',
        },
        default: {},
    }),
})
