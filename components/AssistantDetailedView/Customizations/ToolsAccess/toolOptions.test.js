import { TOOL_OPTIONS, TOOL_LABEL_BY_KEY, normalizeAllowedTools } from './toolOptions'

describe('assistant tool options', () => {
    test('includes get_updates in the selectable assistant permissions', () => {
        expect(TOOL_OPTIONS).toEqual(expect.arrayContaining([{ key: 'get_updates', labelKey: 'Get updates' }]))
        expect(TOOL_LABEL_BY_KEY.get_updates).toBe('Get updates')
    })

    test('keeps get_updates stable during normalization', () => {
        expect(normalizeAllowedTools(['get_updates', 'get_note', 'get_updates'])).toEqual(['get_updates', 'get_notes'])
    })
})
