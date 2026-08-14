const {
    TOOL_ACTIVITY_KINDS,
    ACTION_PRESENTATION,
    getToolActivityKind,
    buildInitialAssistantRunStatusMessage,
    buildToolProgressStatusMessage,
    buildToolActivityDescriptor,
    rememberDelegationDisplayName,
} = require('./assistantProgressStatus')

const en = require('../../i18n/translations/en.json')
const de = require('../../i18n/translations/de.json')
const es = require('../../i18n/translations/es.json')

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
        // An unwhitelisted tool has no specific line to show, so it keeps the rotating
        // generic story. Whitelisted tools are covered by the specific-activity tests.
        const build = elapsedMs => buildToolProgressStatusMessage({ toolName: 'mcp_notion_9f2c', elapsedMs })
        const [firstStatus, laterStatus] = [build(0), build(14_000)]

        expect(firstStatus).toContain('Using the right tool for the job')
        expect(laterStatus).toContain('Checking what came back')
        expect(`${firstStatus}\n${laterStatus}`).not.toMatch(/mcp_notion|step \d|elapsed|updates every/i)
    })

    describe('specific, human-readable tool activity', () => {
        test('names the content type and the search term instead of the tool', () => {
            const status = buildToolProgressStatusMessage({
                toolName: 'search',
                toolArgs: { query: 'Pricing', type: 'notes' },
                elapsedMs: 0,
            })

            expect(status).toContain('Searching notes for “Pricing”')
            expect(status).not.toMatch(/search\b.*\{|query|type:/i)
        })

        test('keeps the specific headline pinned while the reassurance keeps moving', () => {
            const build = elapsedMs =>
                buildToolProgressStatusMessage({ toolName: 'web_search', toolArgs: { query: 'Yjs' }, elapsedMs })

            const [first, later] = [build(0), build(14_000)]

            expect(first).toContain('Searching the web for “Yjs”')
            expect(later).toContain('Searching the web for “Yjs”')
            expect(first.split('\n')[1]).not.toBe(later.split('\n')[1])
        })

        test('falls back to the generic story for a tool with no whitelist rule', () => {
            const status = buildToolProgressStatusMessage({
                toolName: 'mcp_google_drive_9f2c',
                toolArgs: { path: '/private/salaries.xlsx' },
                elapsedMs: 0,
            })

            expect(status).toContain('Using the right tool for the job')
            expect(status).not.toContain('salaries')
            expect(status).not.toContain('mcp_google_drive')
        })

        test('never leaks an id, address or raw payload into the status text', () => {
            const status = buildToolProgressStatusMessage({
                toolName: 'update_task',
                toolArgs: { taskId: '-OzdcDhFZgovZ0n8WZ4q', taskName: 'Landing Page v2' },
                elapsedMs: 0,
            })

            expect(status).toContain('Updating the task “Landing Page v2”')
            expect(status).not.toContain('-OzdcDhFZgovZ0n8WZ4q')
            expect(status).not.toMatch(/taskId|\{|\}/)
        })

        test('exposes the descriptor for persistence on the run activity', () => {
            expect(
                buildToolActivityDescriptor({ toolName: 'search', toolArgs: { query: 'Pricing', type: 'notes' } })
            ).toEqual({ actionKey: 'assistant_activity_search_notes', subject: 'Pricing' })
        })

        test('names a delegated specialist once its tool schema was built', () => {
            const toolName = 'talk_to_assistant_alldone_produ_alldone_cto_1a2b3c4d5e6f'
            rememberDelegationDisplayName(toolName, 'Alldone CTO')

            expect(buildToolProgressStatusMessage({ toolName, toolArgs: { message: 'go' }, elapsedMs: 0 })).toContain(
                'Asking Alldone CTO for help'
            )
        })
    })

    describe('activity keys stay renderable in every language', () => {
        const actionKeys = Object.keys(ACTION_PRESENTATION)

        test('the catalogue is not accidentally empty', () => {
            expect(actionKeys.length).toBeGreaterThan(40)
        })

        test.each([
            ['en', en],
            ['de', de],
            ['es', es],
        ])('%s translates every activity key', (language, translations) => {
            const missing = actionKeys.filter(key => !(key in translations))
            expect(missing).toEqual([])
        })

        test.each([
            ['en', en],
            ['de', de],
            ['es', es],
        ])('%s uses the subject placeholder exactly where the action needs one', (language, translations) => {
            const mismatched = actionKeys.filter(key => {
                const needsSubject = ACTION_PRESENTATION[key][1].includes('%s')
                return String(translations[key]).includes('%{subject}') !== needsSubject
            })
            expect(mismatched).toEqual([])
        })

        test('no activity phrase contains a raw tool name', () => {
            const offenders = actionKeys.filter(key =>
                /_(tool|call)\b|\bmcp_|\bexternal_tool_/.test(ACTION_PRESENTATION[key][1])
            )
            expect(offenders).toEqual([])
        })
    })
})
