const {
    CONFIRMATION_TOOL_NAME,
    END_CALL_TOOL_NAME,
    buildRealtimeToolSchemas,
    canApprovePendingAction,
    convertChatToolSchemaToRealtime,
    getAssistantTranscriptsFromResponse,
    getFunctionCallsFromResponse,
    getResponseTotalTokens,
    requiresVoiceConfirmation,
} = require('./whatsAppCallTools')

describe('WhatsApp call Realtime tools', () => {
    test('converts Chat Completions schemas into Realtime function schemas', () => {
        expect(
            convertChatToolSchemaToRealtime({
                type: 'function',
                function: {
                    name: 'create_task',
                    description: 'Create a task',
                    parameters: { type: 'object', properties: { name: { type: 'string' } } },
                },
            })
        ).toEqual({
            type: 'function',
            name: 'create_task',
            description: 'Create a task',
            parameters: { type: 'object', properties: { name: { type: 'string' } } },
        })
    })

    test('adds the server confirmation resolver and end_call control tools to allowed tools', () => {
        const schemas = buildRealtimeToolSchemas(['create_task'])
        expect(schemas.map(schema => schema.name)).toEqual(['create_task', CONFIRMATION_TOOL_NAME, END_CALL_TOOL_NAME])
    })

    test('the end_call control tool never requires spoken confirmation', () => {
        expect(requiresVoiceConfirmation(END_CALL_TOOL_NAME)).toBe(false)
    })

    test('requires confirmation for calendar writes, VM execution, external tools, and delegation', () => {
        expect(requiresVoiceConfirmation('create_calendar_event')).toBe(true)
        expect(requiresVoiceConfirmation('delete_calendar_event')).toBe(true)
        expect(requiresVoiceConfirmation('execute_task_in_vm')).toBe(true)
        expect(requiresVoiceConfirmation('external_tool_project_tool')).toBe(true)
        expect(requiresVoiceConfirmation('talk_to_assistant')).toBe(true)
        expect(requiresVoiceConfirmation('talk_to_assistant_project_assistant')).toBe(true)
        expect(requiresVoiceConfirmation('create_task')).toBe(false)
        expect(requiresVoiceConfirmation('create_gmail_draft')).toBe(false)
    })

    test('only accepts a recent explicit spoken approval after the pending action', () => {
        const pending = { requestedAt: 1000 }
        expect(canApprovePendingAction(pending, { createdAt: 1100, text: 'Yes, go ahead' }, 1200)).toBe(true)
        expect(canApprovePendingAction(pending, { createdAt: 1100, text: "Yes, but don't do it" }, 1200)).toBe(false)
        expect(canApprovePendingAction(pending, { createdAt: 1100, text: 'What would that do?' }, 1200)).toBe(false)
        expect(canApprovePendingAction(pending, { createdAt: 900, text: 'Yes' }, 1200)).toBe(false)
        expect(canApprovePendingAction(pending, { createdAt: 1100, text: 'Yes' }, 100000)).toBe(false)
    })

    test('extracts usage, transcripts, and function calls from completed responses', () => {
        const response = {
            id: 'response-1',
            usage: { total_tokens: 245 },
            output: [
                {
                    id: 'message-1',
                    type: 'message',
                    content: [
                        { type: 'audio', transcript: 'Done.' },
                        { type: 'output_text', text: 'Anything else?' },
                    ],
                },
                { id: 'call-1', type: 'function_call', name: 'create_task', arguments: '{}' },
            ],
        }
        expect(getResponseTotalTokens(response)).toBe(245)
        expect(getAssistantTranscriptsFromResponse(response)).toEqual([
            { itemId: 'message-1', text: 'Done. Anything else?' },
        ])
        expect(getFunctionCallsFromResponse(response)).toEqual([response.output[1]])
    })
})
