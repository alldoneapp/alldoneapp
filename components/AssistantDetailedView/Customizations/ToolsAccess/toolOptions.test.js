import { DEFAULT_ALLOWED_TOOLS, TOOL_OPTIONS, TOOL_LABEL_BY_KEY, normalizeAllowedTools } from './toolOptions'

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

    test('keeps get_updates stable during normalization', () => {
        expect(normalizeAllowedTools(['get_updates', 'get_note', 'get_updates'])).toEqual(['get_updates', 'get_notes'])
    })

    test('defaults to every selectable tool', () => {
        expect(DEFAULT_ALLOWED_TOOLS).toEqual(TOOL_OPTIONS.map(option => option.key))
    })
})
