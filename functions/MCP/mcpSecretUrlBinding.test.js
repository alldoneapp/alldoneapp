'use strict'

// Security audit 2026-11: a stored MCP credential goes only to the address it was validated for.
// The address lives on the assistant document, which every project member may rewrite.

const mockDocs = new Map()
const mockGetAlldoneTeamMcpToken = jest.fn(async userId => `adapp_${userId}`)

jest.mock('firebase-admin', () => {
    const docRef = path => ({
        path,
        get: jest.fn(async () => {
            const data = mockDocs.get(path)
            return { exists: data !== undefined, data: () => data }
        }),
        set: jest.fn(async (value, options) => {
            const previous = options && options.merge ? mockDocs.get(path) || {} : {}
            mockDocs.set(path, { ...previous, ...value })
        }),
        delete: jest.fn(async () => mockDocs.delete(path)),
    })
    return {
        firestore: () => ({
            doc: docRef,
            runTransaction: async callback =>
                callback({
                    get: ref => ref.get(),
                    update: (ref, value) => mockDocs.set(ref.path, { ...(mockDocs.get(ref.path) || {}), ...value }),
                }),
        }),
    }
})
jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message)
            this.code = code
        }
    },
}))
jest.mock('../Assistant/mcpClient', () => ({ listTools: jest.fn(async () => [{ name: 'tool' }]) }))
jest.mock('./mcpConnectDiagnostics', () => ({ logMcpConnectPhase: jest.fn() }))
jest.mock('../MenubarApp/menubarApp', () => ({ getAlldoneTeamMcpToken: mockGetAlldoneTeamMcpToken }))

const mcpClient = require('../Assistant/mcpClient')
const {
    connectAssistantMcpServer,
    getValidMcpSecret,
    resolveLegacyMcpCredentialBinding,
    resolveMcpSecret,
} = require('./mcpAssistantConnect')

const SECRET_PATH = 'assistants/project-1/mcpSecrets/assistant-1__server-1'
const ASSISTANT_PATH = 'assistants/project-1/items/assistant-1'
const LEGIT_URL = 'https://mcp.example.com/mcp'
const ATTACKER_URL = 'https://attacker.example/mcp'

beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockDocs.clear()
    mockDocs.set('projects/project-1', { userIds: ['owner', 'member'] })
    mockDocs.set(ASSISTANT_PATH, {
        mcpServers: [{ id: 'server-1', label: 'Server', url: LEGIT_URL, transport: 'http', authType: 'bearer' }],
    })
})

afterEach(() => console.warn.mockRestore())

const resolveFor = serverUrl =>
    resolveMcpSecret({
        authType: 'bearer',
        projectId: 'project-1',
        assistantId: 'assistant-1',
        serverId: 'server-1',
        requestUserId: 'member',
        serverUrl,
    })

describe('a stored credential is bound to its address', () => {
    test('connecting stores the address the credential was validated against', async () => {
        await connectAssistantMcpServer({
            userId: 'owner',
            projectId: 'project-1',
            assistantId: 'assistant-1',
            server: { id: 'server-1', label: 'Server', url: LEGIT_URL, authType: 'bearer' },
            secret: { token: 'owner-token' },
        })
        expect(mockDocs.get(SECRET_PATH)).toMatchObject({ token: 'owner-token', boundUrl: LEGIT_URL })
    })

    test('a run never sends the credential to an address a member wrote into the assistant document', async () => {
        mockDocs.set(SECRET_PATH, { authType: 'bearer', token: 'owner-token', boundUrl: LEGIT_URL })
        await expect(resolveFor(ATTACKER_URL)).rejects.toThrow(/no usable credential for its current address/)
        expect(await getValidMcpSecret('project-1', 'assistant-1', 'server-1', ATTACKER_URL)).toBeNull()
        await expect(resolveFor(LEGIT_URL)).resolves.toMatchObject({ token: 'owner-token' })
    })

    test('a credential without a bound address is refused, never bound on first use', async () => {
        mockDocs.set(SECRET_PATH, { authType: 'bearer', token: 'owner-token' })
        // Whatever address the assistant document names at that moment, the run gets nothing.
        await expect(resolveFor(ATTACKER_URL)).rejects.toThrow(/Reconnect it/)
        await expect(resolveFor(LEGIT_URL)).rejects.toThrow(/Reconnect it/)
        expect(mockDocs.get(SECRET_PATH).boundUrl).toBeUndefined()
    })

    test('a run without the address gets no credential', async () => {
        mockDocs.set(SECRET_PATH, { authType: 'bearer', token: 'owner-token', boundUrl: LEGIT_URL })
        expect(await getValidMcpSecret('project-1', 'assistant-1', 'server-1')).toBeNull()
    })

    test('the connect callable only stores a credential together with the address it validated', async () => {
        mockDocs.set(SECRET_PATH, { authType: 'bearer', token: 'owner-token', boundUrl: LEGIT_URL })
        await expect(
            connectAssistantMcpServer({
                userId: 'member',
                projectId: 'project-1',
                assistantId: 'assistant-1',
                server: { id: 'server-1', label: 'Server', url: ATTACKER_URL, authType: 'bearer' },
                secret: null,
            })
        ).rejects.toThrow(/token is required/)
        expect(mcpClient.listTools).not.toHaveBeenCalled()
        expect(mockDocs.get(SECRET_PATH)).toMatchObject({ token: 'owner-token', boundUrl: LEGIT_URL })
    })

    test('an alldone.app token for the requesting user only goes to alldone.team', async () => {
        await expect(
            resolveMcpSecret({ authType: 'alldone_app', requestUserId: 'member', serverUrl: ATTACKER_URL })
        ).rejects.toThrow(/only available for alldone.team/)
        expect(mockGetAlldoneTeamMcpToken).not.toHaveBeenCalled()
        await expect(
            resolveMcpSecret({
                authType: 'alldone_app',
                requestUserId: 'member',
                serverUrl: 'https://alldone.team/mcp',
            })
        ).resolves.toEqual({ token: 'adapp_member' })
    })
})

describe('binding the credentials stored before boundUrl existed (migration)', () => {
    const bearer = { authType: 'bearer', token: 'owner-token' }
    const server = url => ({ id: 'server-1', url, authType: 'bearer' })

    test('binds a bearer credential to the configured address, for review', () => {
        expect(resolveLegacyMcpCredentialBinding({ secret: bearer, server: server(LEGIT_URL) })).toEqual({
            action: 'bind',
            boundUrl: LEGIT_URL,
            source: 'assistant_config',
        })
    })

    test('binds an OAuth credential only when the configured address is on the resource it was issued for', () => {
        const oauth = { authType: 'oauth', accessToken: 'a', oauthContext: { resource: 'https://mcp.example.com/' } }
        const oauthServer = url => ({ ...server(url), authType: 'oauth' })
        expect(resolveLegacyMcpCredentialBinding({ secret: oauth, server: oauthServer(LEGIT_URL) })).toMatchObject({
            action: 'bind',
            boundUrl: LEGIT_URL,
            source: 'oauth_resource',
        })
        expect(resolveLegacyMcpCredentialBinding({ secret: oauth, server: oauthServer(ATTACKER_URL) })).toMatchObject({
            action: 'reconnect',
            reason: 'configured_url_differs_from_oauth_resource',
        })
    })

    test('leaves a credential without a configured server unbound and skips bound ones', () => {
        expect(resolveLegacyMcpCredentialBinding({ secret: bearer, server: null })).toMatchObject({
            action: 'reconnect',
        })
        expect(
            resolveLegacyMcpCredentialBinding({
                secret: { ...bearer, boundUrl: LEGIT_URL },
                server: server(ATTACKER_URL),
            })
        ).toMatchObject({ action: 'already_bound', boundUrl: LEGIT_URL })
    })
})
