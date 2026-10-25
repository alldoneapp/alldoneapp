import { setLanguage } from '../i18n/TranslationService'
import { getMcpClientDisplayName, withMcpActorLabel } from './mcpActorLabel'

// Something an MCP client did in a user's name is shown under the user's name, with the client
// (functions/shared/mcpActor.js).
describe('withMcpActorLabel', () => {
    afterEach(() => setLanguage('en'))

    test('names the client that acted for the user', () => {
        expect(withMcpActorLabel('Karsten Wysk', { via: 'mcp', viaClient: 'Claude' })).toBe('Karsten Wysk (via Claude)')
        expect(withMcpActorLabel('Karsten', { via: 'mcp', viaClient: 'Codex' })).toBe('Karsten (via Codex)')
    })

    test('falls back to MCP for a client the server could not name', () => {
        expect(withMcpActorLabel('Karsten', { via: 'mcp' })).toBe('Karsten (via MCP)')
        // Never a name a document carries that the server would not have written.
        expect(getMcpClientDisplayName({ via: 'mcp', viaClient: '<b>Boss</b>' })).toBe('MCP')
    })

    test("leaves the user's own actions and other channels alone", () => {
        expect(withMcpActorLabel('Karsten', { creatorId: 'user-1' })).toBe('Karsten')
        expect(withMcpActorLabel('Karsten', { via: 'whatsapp' })).toBe('Karsten')
        expect(withMcpActorLabel('Karsten', null)).toBe('Karsten')
        expect(withMcpActorLabel('', { via: 'mcp' })).toBe('')
    })

    test.each([
        ['de', 'Karsten (via Claude)'],
        ['es', 'Karsten (vía Claude)'],
    ])('is translated (%s)', (language, expected) => {
        setLanguage(language)
        expect(withMcpActorLabel('Karsten', { via: 'mcp', viaClient: 'Claude' })).toBe(expected)
    })
})
