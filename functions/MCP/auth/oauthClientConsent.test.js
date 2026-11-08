const { describeOAuthClientForConsent, escapeHtml, sanitizeClientName } = require('./oauthClientConsent')

describe('what the MCP consent screen says about a client (security audit 2026-11)', () => {
    test('names a known redirect host itself, whatever the registration claims', () => {
        expect(
            describeOAuthClientForConsent({ clientName: 'Evil' }, 'https://claude.ai/api/mcp/auth_callback')
        ).toEqual({ clientLabel: 'Claude', redirectHost: 'claude.ai', kind: 'known' })
        expect(
            describeOAuthClientForConsent(null, 'https://chatgpt.com/connector_platform_oauth_redirect')
        ).toMatchObject({ clientLabel: 'ChatGPT', kind: 'known' })
    })

    test('a client calling itself Claude but redirecting elsewhere is shown with its real host', () => {
        expect(
            describeOAuthClientForConsent({ clientName: 'Claude' }, 'https://evil-mcp-client.example.test/cb')
        ).toEqual({ clientLabel: 'Claude', redirectHost: 'evil-mcp-client.example.test', kind: 'unverified' })
        expect(describeOAuthClientForConsent({ clientName: 'x' }, 'https://claude.ai.evil.example/cb').kind).toBe(
            'unverified'
        )
    })

    test('a loopback redirect (Claude Code, Codex) is a local app', () => {
        expect(describeOAuthClientForConsent({ clientName: 'Claude Code' }, 'http://localhost:33418/callback')).toEqual(
            {
                clientLabel: 'Claude Code',
                redirectHost: 'localhost:33418',
                kind: 'local',
            }
        )
    })

    test('an unknown or unreadable registration is an unknown app', () => {
        expect(describeOAuthClientForConsent(null, null)).toEqual({
            clientLabel: 'An unknown app',
            redirectHost: 'an unknown address',
            kind: 'unverified',
        })
    })

    test('a declared name is one short line of text', () => {
        expect(sanitizeClientName('a\nb c\u0000d')).toBe('a b c d')
        expect(sanitizeClientName('x'.repeat(500))).toHaveLength(60)
        expect(sanitizeClientName({})).toBe('')
        expect(escapeHtml('<b>"\'&')).toBe('&lt;b&gt;&quot;&#39;&amp;')
    })
})
