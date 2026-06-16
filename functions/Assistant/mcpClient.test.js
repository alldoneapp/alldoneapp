const { normalizeServerConfig, buildAuthHeaders } = require('./mcpClient')

describe('mcpClient.normalizeServerConfig', () => {
    test('accepts https + defaults transport to http', () => {
        const n = normalizeServerConfig({ url: 'https://mcp.example.com/mcp' })
        expect(n.transport).toBe('http')
        expect(n.url.toString()).toBe('https://mcp.example.com/mcp')
    })

    test('keeps explicit sse transport and clamps timeout', () => {
        const n = normalizeServerConfig({ url: 'https://mcp.example.com', transport: 'sse', timeoutMs: 999999 })
        expect(n.transport).toBe('sse')
        expect(n.timeoutMs).toBe(60000)
    })

    test('allows http only for localhost', () => {
        expect(() => normalizeServerConfig({ url: 'http://localhost:3000/mcp' })).not.toThrow()
        expect(() => normalizeServerConfig({ url: 'http://example.com/mcp' })).toThrow(/https/)
    })

    test('rejects missing or invalid url', () => {
        expect(() => normalizeServerConfig({})).toThrow(/URL is required/)
        expect(() => normalizeServerConfig({ url: 'not a url' })).toThrow(/invalid/)
    })
})

describe('mcpClient.buildAuthHeaders', () => {
    test('none -> no headers', () => {
        expect(buildAuthHeaders({ authType: 'none' }, null)).toEqual({})
        expect(buildAuthHeaders({}, null)).toEqual({})
    })

    test('bearer -> Authorization header from token', () => {
        expect(buildAuthHeaders({ authType: 'bearer' }, { token: 'abc' })).toEqual({
            Authorization: 'Bearer abc',
        })
    })

    test('bearer without token throws', () => {
        expect(() => buildAuthHeaders({ authType: 'bearer' }, {})).toThrow(/token/)
    })

    test('oauth -> Authorization header from accessToken', () => {
        expect(buildAuthHeaders({ authType: 'oauth' }, { accessToken: 'xyz' })).toEqual({
            Authorization: 'Bearer xyz',
        })
    })

    test('unknown auth type throws', () => {
        expect(() => buildAuthHeaders({ authType: 'weird' }, {})).toThrow(/Unsupported/)
    })
})
