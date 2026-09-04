const { resolveRunAllowedTools } = require('./runToolGrants')

describe('resolveRunAllowedTools', () => {
    test('returns the persisted list unchanged when the run grants nothing', () => {
        const persisted = ['web_search', 'update_contact']
        expect(resolveRunAllowedTools(persisted, { projectId: 'p' })).toBe(persisted)
        expect(resolveRunAllowedTools(persisted, null)).toBe(persisted)
    })

    test('adds server-granted tools the assistant owner never enabled, without duplicates', () => {
        // The contact enrichment run: the assistant's persisted list predates fetch_url.
        expect(
            resolveRunAllowedTools(['web_search', 'update_contact'], {
                serverGrantedTools: ['web_search', 'fetch_url', 'find_profile_photo', '', 42],
            })
        ).toEqual(['web_search', 'update_contact', 'fetch_url', 'find_profile_photo'])
    })

    test('a missing persisted list still honours the grant', () => {
        expect(resolveRunAllowedTools(undefined, { serverGrantedTools: ['fetch_url'] })).toEqual(['fetch_url'])
    })
})
