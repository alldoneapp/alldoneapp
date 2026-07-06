const { getToolSchemas } = require('../Assistant/toolSchemas')

const CONFIRMATION_TOOL_NAME = 'resolve_voice_confirmation'
const END_CALL_TOOL_NAME = 'end_call'
const CONFIRMATION_TTL_MS = 90 * 1000
const ALWAYS_CONFIRM_TOOLS = new Set([
    'create_calendar_event',
    'update_calendar_event',
    'delete_calendar_event',
    'execute_task_in_vm',
    'talk_to_assistant',
])

const EXPLICIT_APPROVAL_PATTERN = /\b(yes|approve|approved|confirm|confirmed|go ahead|proceed|do it|please do|okay|ok|sure|sounds good|ja|bestätige|mach das|weiter|sí|si|confirmo|adelante|hazlo)\b/i
const EXPLICIT_REJECTION_PATTERN = /\b(no|not|don't|do not|cancel|cancelled|stop|nein|nicht|abbrechen|stopp|no lo hagas|cancelar|detener)\b/i

function convertChatToolSchemaToRealtime(schema) {
    const fn = schema?.function
    if (schema?.type !== 'function' || !fn?.name) return null
    return {
        type: 'function',
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || { type: 'object', properties: {} },
    }
}

function buildConfirmationToolSchema() {
    return {
        type: 'function',
        name: CONFIRMATION_TOOL_NAME,
        description:
            'Resolve the exact pending sensitive action after the caller explicitly approves or rejects it. Never use approved=true unless the caller just gave clear spoken approval.',
        parameters: {
            type: 'object',
            properties: {
                approved: {
                    type: 'boolean',
                    description: 'True only after clear spoken approval; false after rejection or cancellation.',
                },
            },
            required: ['approved'],
        },
    }
}

function buildEndCallToolSchema() {
    return {
        type: 'function',
        name: END_CALL_TOOL_NAME,
        description:
            'End and hang up the current phone call. Use this only when the conversation is genuinely finished — for example after the caller says goodbye, asks you to hang up, or confirms there is nothing else they need. Say a short, warm spoken farewell first in the same turn, then call this tool. Do not use it to pause, and never hang up while a task is still in progress or a question is unanswered.',
        parameters: {
            type: 'object',
            properties: {
                reason: {
                    type: 'string',
                    description: 'Short reason the call is ending (e.g. "caller said goodbye", "all done").',
                },
            },
        },
    }
}

function buildRealtimeToolSchemas(allowedTools, dynamicToolSchemas = {}) {
    const staticSchemas = getToolSchemas(allowedTools)
    const dynamicSchemas = [
        ...(dynamicToolSchemas.delegationToolSchemas || []),
        ...(dynamicToolSchemas.externalToolSchemas || []),
    ]
    const byName = new Map()

    ;[...staticSchemas, ...dynamicSchemas].forEach(schema => {
        const converted = convertChatToolSchemaToRealtime(schema)
        if (converted) byName.set(converted.name, converted)
    })
    byName.set(CONFIRMATION_TOOL_NAME, buildConfirmationToolSchema())
    byName.set(END_CALL_TOOL_NAME, buildEndCallToolSchema())

    return Array.from(byName.values())
}

function requiresVoiceConfirmation(toolName) {
    const normalized = String(toolName || '')
    return (
        ALWAYS_CONFIRM_TOOLS.has(normalized) ||
        normalized.startsWith('external_tool_') ||
        normalized.startsWith('talk_to_assistant_')
    )
}

function isExplicitSpokenApproval(text) {
    const normalized = String(text || '').trim()
    return !EXPLICIT_REJECTION_PATTERN.test(normalized) && EXPLICIT_APPROVAL_PATTERN.test(normalized)
}

function canApprovePendingAction(pendingAction, lastUserTurn, now = Date.now()) {
    if (!pendingAction || !lastUserTurn) return false
    if (now - Number(pendingAction.requestedAt || 0) > CONFIRMATION_TTL_MS) return false
    if (Number(lastUserTurn.createdAt || 0) <= Number(pendingAction.requestedAt || 0)) return false
    return isExplicitSpokenApproval(lastUserTurn.text)
}

function getResponseTotalTokens(response) {
    const usage = response?.usage || {}
    const total = Number(usage.total_tokens ?? usage.totalTokens ?? 0)
    return Number.isFinite(total) && total > 0 ? Math.round(total) : 0
}

function getFunctionCallsFromResponse(response) {
    return (Array.isArray(response?.output) ? response.output : []).filter(item => item?.type === 'function_call')
}

function getAssistantTranscriptsFromResponse(response) {
    const transcripts = []
    ;(Array.isArray(response?.output) ? response.output : []).forEach(item => {
        if (item?.type && item.type !== 'message') return
        const text = (Array.isArray(item?.content) ? item.content : [])
            .map(content => String(content?.transcript || content?.text || '').trim())
            .filter(Boolean)
            .join(' ')
        if (text) transcripts.push({ itemId: item.id || response.id || '', text })
    })
    return transcripts
}

module.exports = {
    CONFIRMATION_TOOL_NAME,
    CONFIRMATION_TTL_MS,
    END_CALL_TOOL_NAME,
    buildEndCallToolSchema,
    buildRealtimeToolSchemas,
    canApprovePendingAction,
    convertChatToolSchemaToRealtime,
    getAssistantTranscriptsFromResponse,
    getFunctionCallsFromResponse,
    getResponseTotalTokens,
    isExplicitSpokenApproval,
    requiresVoiceConfirmation,
}
