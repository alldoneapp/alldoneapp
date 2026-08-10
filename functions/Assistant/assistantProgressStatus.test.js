const {
    TOOL_ACTIVITY_KINDS,
    getToolActivityKind,
    buildInitialAssistantRunStatusMessage,
    buildToolProgressStatusMessage,
} = require('./assistantProgressStatus')

describe('assistant progress status', () => {
    test.each([
        ['web_search', TOOL_ACTIVITY_KINDS.WEB],
        ['get_notes', TOOL_ACTIVITY_KINDS.WORKSPACE],
        ['search_gmail', TOOL_ACTIVITY_KINDS.COMMUNICATION],
        ['update_note', TOOL_ACTIVITY_KINDS.CHANGE],
        ['talk_to_assistant_project_helper_123', TOOL_ACTIVITY_KINDS.SPECIALIST],
        ['execute_task_in_vm', TOOL_ACTIVITY_KINDS.SPECIALIST],
        ['unknown_tool', TOOL_ACTIVITY_KINDS.GENERIC],
    ])('maps %s to a friendly activity kind', (toolName, expectedKind) => {
        expect(getToolActivityKind(toolName)).toBe(expectedKind)
    })

    test('keeps the initial status conversational and free of implementation details', () => {
        const status = buildInitialAssistantRunStatusMessage()

        expect(status).toContain('Getting everything lined up')
        expect(status).not.toMatch(/under the hood|initial analysis|step \d|updates every/i)
    })

    test('advances a tool story without exposing the internal tool name or counters', () => {
        const firstStatus = buildToolProgressStatusMessage({ toolName: 'web_search', elapsedMs: 0 })
        const laterStatus = buildToolProgressStatusMessage({ toolName: 'web_search', elapsedMs: 14_000 })

        expect(firstStatus).toContain('Searching for fresh information')
        expect(laterStatus).toContain('Cross-checking what I found')
        expect(`${firstStatus}\n${laterStatus}`).not.toMatch(/web_search|step \d|elapsed|updates every/i)
    })
})
