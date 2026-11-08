'use strict'

// authType 'alldone_app': an assistant calls alldone.team/mcp as the person it answers, with a
// short-lived alldone.app token minted for that person, never with a stored secret.

const mockGetAlldoneTeamMcpToken = jest.fn(async userId => `adapp_${userId}`)
jest.mock('firebase-admin', () => ({ firestore: () => ({}) }))
jest.mock('../MenubarApp/menubarApp', () => ({ getAlldoneTeamMcpToken: mockGetAlldoneTeamMcpToken }))

const { normalizeServerInput, buildSecretRecords, resolveMcpSecret } = require('./mcpAssistantConnect')
const { buildAuthHeaders } = require('../Assistant/mcpClient')

const server = url => ({ label: 'alldone.team', url, transport: 'http', authType: 'alldone_app' })

test('is allowed only for alldone.team over https', () => {
    expect(normalizeServerInput(server('https://alldone.team/mcp'))).toMatchObject({ authType: 'alldone_app' })
    expect(() => normalizeServerInput(server('https://evil.example/mcp'))).toThrow(/only available for alldone.team/)
    expect(() => normalizeServerInput(server('https://alldone.team.evil.example/mcp'))).toThrow(/only available/)
    expect(() => normalizeServerInput(server('http://localhost/mcp'))).toThrow(/only available/)
})

test('stores no secret', () => {
    expect(buildSecretRecords('alldone_app', { token: 'pasted' })).toEqual({
        toStore: null,
        toValidate: null,
        tokenLast4: '',
    })
})

test('a run uses a token for its requesting user and sends it as a bearer token', async () => {
    const secret = await resolveMcpSecret({
        authType: 'alldone_app',
        projectId: 'p',
        assistantId: 'a',
        serverId: 's',
        requestUserId: 'user-1',
    })
    expect(mockGetAlldoneTeamMcpToken).toHaveBeenCalledWith('user-1')
    expect(buildAuthHeaders({ authType: 'alldone_app' }, secret)).toEqual({ Authorization: 'Bearer adapp_user-1' })
})

test('a run without a requesting user gets no token', async () => {
    await expect(
        resolveMcpSecret({ authType: 'alldone_app', projectId: 'p', assistantId: 'a', serverId: 's' })
    ).rejects.toThrow(/signed-in user/)
    expect(await resolveMcpSecret({ authType: 'none' })).toBeNull()
})
