const {
    SUBJECT_MAX_LENGTH,
    sanitizeActivitySubject,
    describeToolActivity,
    rememberDelegationDisplayName,
} = require('./assistantToolActivity')

const { toolSchemas } = require('./toolSchemas')

describe('sanitizeActivitySubject', () => {
    test.each([
        ['Pricing', 'Pricing'],
        ['  Pricing\n\nstrategy  ', 'Pricing strategy'],
        ['"Quoted title"', 'Quoted title'],
        ['„Deutsche Anführungszeichen“', 'Deutsche Anführungszeichen'],
    ])('keeps %s readable', (input, expected) => {
        expect(sanitizeActivitySubject(input)).toBe(expected)
    })

    test.each([
        ['-OzdcDhFZgovZ0n8WZ4q', 'a Firebase push id'],
        ['a4f9c8d7e6b5a4f3c2d1', 'a hex id'],
        ['3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'a uuid'],
        ['sk-abc123XYZdefGHI', 'an API key'],
        ['glpat-AbCdEf123456', 'a GitLab token'],
        ['Bearer eyJhbGciOi', 'a bearer token'],
        ['karsten@example.com', 'an email address'],
        ['https://example.com/secret', 'a URL'],
        ['x', 'a value too short to mean anything'],
        ['', 'an empty string'],
    ])('refuses to expose %s (%s)', input => {
        expect(sanitizeActivitySubject(input)).toBe('')
    })

    test.each([[123], [null], [undefined], [{ query: 'x' }], [['a']]])('ignores the non-string value %p', input => {
        expect(sanitizeActivitySubject(input)).toBe('')
    })

    test('truncates a long value on a word boundary', () => {
        const subject = sanitizeActivitySubject(
            'This is a very long note title that goes well beyond the maximum length allowed'
        )

        expect(subject.length).toBeLessThanOrEqual(SUBJECT_MAX_LENGTH + 1)
        expect(subject.endsWith('…')).toBe(true)
        expect(subject).not.toMatch(/\s…$/)
    })

    test('strips control characters rather than passing them through', () => {
        expect(sanitizeActivitySubject('Pri\u0000cing\u001Fplan')).toBe('Pri cing plan')
    })
})

describe('describeToolActivity', () => {
    test('names the searched content type and the search term', () => {
        expect(describeToolActivity({ toolName: 'search', toolArgs: { query: 'Pricing', type: 'notes' } })).toEqual({
            actionKey: 'assistant_activity_search_notes',
            subject: 'Pricing',
        })
    })

    test.each([
        ['tasks', 'assistant_activity_search_tasks'],
        ['goals', 'assistant_activity_search_goals'],
        ['contacts', 'assistant_activity_search_contacts'],
        ['chats', 'assistant_activity_search_chats'],
        ['all', 'assistant_activity_search_workspace'],
        [undefined, 'assistant_activity_search_workspace'],
    ])('maps the %s search type to %s', (type, expectedKey) => {
        expect(describeToolActivity({ toolName: 'search', toolArgs: { query: 'Pricing', type } }).actionKey).toBe(
            expectedKey
        )
    })

    test('falls back to the action without a term when the query is missing', () => {
        expect(describeToolActivity({ toolName: 'search', toolArgs: { type: 'notes' } })).toEqual({
            actionKey: 'assistant_activity_search_workspace_plain',
            subject: null,
        })
    })

    test('describes a read tool that has no search parameter at all', () => {
        // get_notes filters by project/date only, so there is never a term to show.
        expect(
            describeToolActivity({ toolName: 'get_notes', toolArgs: { projectId: '-M6X9vdIokG7HAammHGg' } })
        ).toEqual({ actionKey: 'assistant_activity_read_notes', subject: null })
    })

    test('resolves the legacy get_note alias like get_notes', () => {
        expect(describeToolActivity({ toolName: 'get_note', toolArgs: {} }).actionKey).toBe(
            'assistant_activity_read_notes'
        )
    })

    test('prefers the first whitelisted parameter that yields a usable subject', () => {
        expect(
            describeToolActivity({
                toolName: 'update_task',
                toolArgs: { taskId: '-OzdcDhFZgovZ0n8WZ4q', taskName: 'Landing Page v2' },
            })
        ).toEqual({ actionKey: 'assistant_activity_update_task', subject: 'Landing Page v2' })
    })

    test('degrades to the plain action when every whitelisted parameter is an id', () => {
        expect(describeToolActivity({ toolName: 'update_task', toolArgs: { taskId: '-OzdcDhFZgovZ0n8WZ4q' } })).toEqual(
            {
                actionKey: 'assistant_activity_update_task_plain',
                subject: null,
            }
        )
    })

    test.each([
        ['mcp_google_drive_9f2c', { path: '/private/salaries.xlsx' }],
        ['external_tool_hubspot_deal_1a2b', { dealValue: 50000 }],
        ['some_future_tool', { query: 'Pricing' }],
    ])('exposes nothing for the unwhitelisted tool %s', (toolName, toolArgs) => {
        expect(describeToolActivity({ toolName, toolArgs })).toEqual({ actionKey: null, subject: null })
    })

    test('never exposes an email subject line or recipients', () => {
        const descriptor = describeToolActivity({
            toolName: 'create_gmail_draft',
            toolArgs: { to: 'karsten@example.com', subject: 'Salary review', body: 'Confidential' },
        })

        expect(descriptor).toEqual({ actionKey: 'assistant_activity_draft_email', subject: null })
    })

    test.each([[undefined], [''], [null]])('returns nothing for the empty tool name %p', toolName => {
        expect(describeToolActivity({ toolName, toolArgs: {} })).toEqual({ actionKey: null, subject: null })
    })

    test('tolerates missing arguments entirely', () => {
        expect(describeToolActivity()).toEqual({ actionKey: null, subject: null })
        expect(describeToolActivity({ toolName: 'search' }).actionKey).toBe('assistant_activity_search_workspace_plain')
    })

    describe('delegation', () => {
        test('names the specialist once the tool schema has been built', () => {
            const toolName = 'talk_to_assistant_alldone_produ_alldone_cto_9f2c1a4b7d3e'
            rememberDelegationDisplayName(toolName, 'Alldone CTO')

            expect(describeToolActivity({ toolName, toolArgs: { message: 'Please review' } })).toEqual({
                actionKey: 'assistant_activity_ask_assistant',
                subject: 'Alldone CTO',
            })
        })

        test('stays anonymous when the display name was never registered', () => {
            expect(describeToolActivity({ toolName: 'talk_to_assistant_unknown_target_abc123', toolArgs: {} })).toEqual(
                { actionKey: 'assistant_activity_ask_assistant_plain', subject: null }
            )
        })

        test('never exposes the delegated message itself', () => {
            const toolName = 'talk_to_assistant_project_helper_0011223344ff'
            rememberDelegationDisplayName(toolName, 'Anna')

            expect(
                describeToolActivity({ toolName, toolArgs: { message: 'Secret internal instruction' } }).subject
            ).toBe('Anna')
        })
    })
})

describe('whitelist safety against the real tool schemas', () => {
    // Every parameter this module is willing to show must actually exist on the tool it
    // belongs to; a renamed schema field should fail here rather than silently degrade
    // every status line to the generic wording.
    const WHITELISTED_PARAMS = {
        search: ['query'],
        web_search: ['query'],
        search_gmail: ['query'],
        search_calendar_events: ['query'],
        create_task: ['name'],
        update_task: ['taskName', 'name'],
        create_note: ['title'],
        update_note: ['noteTitle', 'title'],
        update_contact: ['contactName'],
        create_calendar_event: ['summary'],
        update_calendar_event: ['summary'],
        get_weather: ['location'],
        get_route_info: ['destination'],
        get_local_recommendations: ['query'],
        load_skill: ['name'],
        execute_task_in_vm: ['objective'],
    }

    test.each(Object.entries(WHITELISTED_PARAMS))(
        '%s still declares its whitelisted parameters',
        (toolName, params) => {
            const properties = toolSchemas[toolName]?.function?.parameters?.properties || {}
            params.forEach(param => expect(Object.keys(properties)).toContain(param))
        }
    )

    test('no whitelisted parameter is an id, token or address field', () => {
        Object.values(WHITELISTED_PARAMS)
            .flat()
            .forEach(param => expect(param).not.toMatch(/id$|ids$|token|secret|email|password|url/i))
    })
})
