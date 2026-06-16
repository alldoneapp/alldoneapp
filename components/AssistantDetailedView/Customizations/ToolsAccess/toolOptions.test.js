import {
    DEFAULT_ALLOWED_TOOLS,
    OPT_IN_ONLY_TOOLS,
    TOOL_OPTIONS,
    TOOL_LABEL_BY_KEY,
    normalizeAllowedTools,
} from './toolOptions'

describe('assistant tool options', () => {
    test('includes get_updates in the selectable assistant permissions', () => {
        expect(TOOL_OPTIONS).toEqual(expect.arrayContaining([{ key: 'get_updates', labelKey: 'Get updates' }]))
        expect(TOOL_LABEL_BY_KEY.get_updates).toBe('Get updates')
    })

    test('includes project OKRs in the selectable assistant permissions', () => {
        expect(TOOL_OPTIONS).toEqual(
            expect.arrayContaining([{ key: 'get_project_okrs', labelKey: 'Get project OKRs' }])
        )
        expect(TOOL_LABEL_BY_KEY.get_project_okrs).toBe('Get project OKRs')
    })

    test('includes project happiness in the selectable assistant permissions', () => {
        expect(TOOL_OPTIONS).toEqual(
            expect.arrayContaining([{ key: 'get_project_happiness', labelKey: 'Get project happiness' }])
        )
        expect(TOOL_LABEL_BY_KEY.get_project_happiness).toBe('Get project happiness')
    })

    test('includes privacy-safe Calendar availability in selectable permissions', () => {
        expect(TOOL_OPTIONS).toEqual(
            expect.arrayContaining([{ key: 'find_calendar_availability', labelKey: 'Find free Calendar times' }])
        )
        expect(TOOL_LABEL_BY_KEY.find_calendar_availability).toBe('Find free Calendar times')
    })

    test('keeps get_updates stable during normalization', () => {
        expect(normalizeAllowedTools(['get_updates', 'get_note', 'get_updates'])).toEqual(['get_updates', 'get_notes'])
    })

    test('defaults to every selectable tool except opt-in-only tools', () => {
        expect(DEFAULT_ALLOWED_TOOLS).toEqual(
            TOOL_OPTIONS.map(option => option.key).filter(key => !OPT_IN_ONLY_TOOLS.has(key))
        )
    })

    test('enables the VM task tool by default', () => {
        expect(DEFAULT_ALLOWED_TOOLS).toContain('execute_task_in_vm')
        expect(TOOL_OPTIONS.map(option => option.key)).toContain('execute_task_in_vm')
    })

    test('includes the MCP servers tool as opt-in only', () => {
        expect(TOOL_OPTIONS).toEqual(
            expect.arrayContaining([{ key: 'mcp_servers', labelKey: 'Use connected MCP servers' }])
        )
        expect(OPT_IN_ONLY_TOOLS.has('mcp_servers')).toBe(true)
        expect(DEFAULT_ALLOWED_TOOLS).not.toContain('mcp_servers')
    })
})
