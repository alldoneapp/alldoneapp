'use strict'

const mockUserDocGet = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        collection: jest.fn(path => {
            if (path === 'users') {
                return {
                    doc: jest.fn(() => ({
                        get: mockUserDocGet,
                    })),
                }
            }

            return {
                doc: jest.fn(() => ({
                    get: jest.fn(),
                    set: jest.fn(),
                })),
            }
        }),
    })),
    app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })),
}))

jest.mock('./auth/cloudOAuth.js', () => ({
    CloudOAuthHandler: jest.fn().mockImplementation(() => ({})),
    CloudSessionManager: jest.fn().mockImplementation(() => ({})),
    UserSessionManager: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('./config/environments.js', () => ({
    getEnvironmentConfig: jest.fn(() => ({ mcpBaseUrl: 'https://my.alldone.app' })),
}))

jest.mock(
    'firebase-functions/params',
    () => ({
        defineString: jest.fn(() => ({ value: jest.fn(() => '') })),
    }),
    { virtual: true }
)

// The MCP server now delegates every tool that also exists as an internal
// assistant tool to executeToolNatively, so we mock that single seam instead of
// the individual shared services.
const mockExecuteToolNatively = jest.fn()
jest.mock('../Assistant/assistantHelper', () => ({
    executeToolNatively: mockExecuteToolNatively,
}))

describe('MCP OAuth discovery challenges', () => {
    let server, res
    beforeEach(() => {
        const { AlldoneSimpleMCPServer } = require('./mcpServerSimple')
        server = Object.create(AlldoneSimpleMCPServer.prototype)
        server.getAuthenticatedUserForClient = jest.fn().mockRejectedValue(new Error('Authentication required'))
        res = {
            status: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        }
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => jest.restoreAllMocks())

    const expectChallenge = () => {
        expect(res.status).toHaveBeenCalledWith(401)
        const headers = res.set.mock.calls.map(([value]) => value).find(value => value['WWW-Authenticate'])
        expect(headers['WWW-Authenticate']).toContain(
            'resource_metadata="https://my.alldone.app/.well-known/oauth-protected-resource/mcpServer"'
        )
        expect(headers['Cache-Control']).toBe('no-store')
    }

    test.each([{}, { authorization: 'Bearer expired-token' }])(
        'GET advertises discovery before credentials can be used (%j)',
        async headers => {
            await server.handleRequest({ method: 'GET', path: '/mcpServer', headers }, res)
            expectChallenge()
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'unauthorized' }))
        }
    )

    test('POST initialize advertises the same metadata URL', async () => {
        server.clientSessions = new Map()
        server.getOrCreateMCPSession = jest.fn().mockReturnValue('session-test')
        await server.handleRequest(
            {
                method: 'POST',
                path: '/mcpServer',
                headers: { 'content-type': 'application/json' },
                body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
            },
            res
        )
        expectChallenge()
    })

    test('protected tool requests advertise the same metadata URL', async () => {
        await server.handleRequest(
            {
                method: 'POST',
                path: '/mcpServer',
                headers: { 'content-type': 'application/json' },
                body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_tasks' } },
            },
            res
        )
        expectChallenge()
    })

    test('metadata discovery stays public and identifies the configured MCP resource', async () => {
        await server.handleRequest(
            {
                method: 'GET',
                path: '/.well-known/oauth-protected-resource/mcpServer',
                headers: {},
            },
            res
        )
        expect(server.getAuthenticatedUserForClient).not.toHaveBeenCalled()
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ resource: 'https://my.alldone.app/mcpServer' }))
        expect(res.status).not.toHaveBeenCalledWith(401)
    })

    test('the MCP SDK resolves the challenge to the public metadata endpoint', () => {
        const { extractWWWAuthenticateParams } = require('@modelcontextprotocol/sdk/client/auth')
        const headers = server.getOAuthChallengeHeaders()
        const discovery = extractWWWAuthenticateParams({ headers: { get: name => headers[name] } })
        expect(discovery.resourceMetadataUrl.toString()).toBe(
            'https://my.alldone.app/.well-known/oauth-protected-resource/mcpServer'
        )
        expect(discovery.scope).toBe('read write mcp:tools')
    })
})

describe('AlldoneSimpleMCPServer tools/list', () => {
    let originalSetTimeout
    let AlldoneSimpleMCPServer

    beforeAll(() => {
        originalSetTimeout = global.setTimeout
        global.setTimeout = jest.fn(() => 0)
        ;({ AlldoneSimpleMCPServer } = require('./mcpServerSimple'))
    })

    afterAll(() => {
        global.setTimeout = originalSetTimeout
    })

    beforeEach(() => {
        jest.clearAllMocks()
    })

    const listTools = async () => {
        const server = new AlldoneSimpleMCPServer()
        const response = await server.handleSingleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {})
        return response.result.tools
    }

    test('exposes the shared parent goal contract for create_task and update_task', async () => {
        const tools = await listTools()
        for (const name of ['create_task', 'update_task']) {
            const tool = tools.find(entry => entry.name === name)
            expect(tool.inputSchema.properties.parentGoalId.type).toEqual(['string', 'null'])
            expect(tool.inputSchema.required).not.toContain('parentGoalId')
            expect(tool.inputSchema.properties.parentGoalProjectId.type).toBe('string')
        }
    })

    test('derives get_contacts schema from the shared assistant tool schema', async () => {
        const tools = await listTools()
        const tool = tools.find(entry => entry.name === 'get_contacts')
        expect(tool).toBeDefined()
        expect(tool.inputSchema.properties.projectId.type).toBe('string')
        expect(tool.inputSchema.properties.projectName.type).toBe('string')
        expect(tool.inputSchema.properties.date.type).toBe('string')
        expect(tool.inputSchema.properties.limit.type).toBe('number')
    })

    test('exposes the safe patch fields for update_note', async () => {
        const tools = await listTools()
        const tool = tools.find(entry => entry.name === 'update_note')
        expect(tool).toBeDefined()
        expect(tool.inputSchema.required).toEqual([])
        expect(tool.inputSchema.properties.mode.enum).toEqual(['prepend', 'patch'])
        expect(tool.inputSchema.properties.edits.type).toBe('array')
        expect(tool.inputSchema.properties.edits.items.properties.type.enum).toEqual([
            'replace_text',
            'replace_section',
            'insert_before',
            'insert_after',
        ])
    })

    test('exposes Kontaktstatus assignment through the shared update_contact tool', async () => {
        const tools = await listTools()
        const tool = tools.find(entry => entry.name === 'update_contact')
        expect(tool.inputSchema.properties.contactStatusId.type).toBe('string')
        expect(tool.inputSchema.properties.contactStatusName.type).toBe('string')
        expect(tool.inputSchema.properties.contactStatusId.description).toContain('get_user_projects')
    })

    test('includes the delegated coverage-gap tools and the MCP-only tools', async () => {
        const names = (await listTools()).map(tool => tool.name)
        expect(names).toEqual(
            expect.arrayContaining([
                'create_task',
                'get_goals',
                'get_updates',
                'search_gmail',
                'create_calendar_event',
                'update_user_memory',
                'web_search',
                'delete_authentication_data',
                'get_current_user_info',
            ])
        )
    })

    test('exposes the assistant suggestion origin contract for create_task', async () => {
        const tool = (await listTools()).find(entry => entry.name === 'create_task')

        expect(tool.description).toContain('only when the end user explicitly asked')
        expect(tool.description).toContain('automation instruction')
        expect(tool.inputSchema.properties.taskOrigin.enum).toEqual(['user_request', 'assistant_suggestion'])
        expect(tool.inputSchema.properties.comment.description).toContain('context-specific reason')
    })

    test('exposes get_local_recommendations with its coordinate schema over MCP', async () => {
        const tools = await listTools()
        const tool = tools.find(entry => entry.name === 'get_local_recommendations')
        expect(tool).toBeDefined()
        expect(tool.inputSchema.required).toEqual(['latitude', 'longitude'])
        expect(tool.inputSchema.properties.query.type).toBe('string')
        expect(tool.inputSchema.properties.radius.type).toBe('number')
    })

    test('does not expose assistant/thread-only tools over MCP', async () => {
        const names = (await listTools()).map(tool => tool.name)
        expect(names).not.toContain('execute_task_in_vm')
        expect(names).not.toContain('talk_to_assistant')
        expect(names).not.toContain('compact_thread_context')
        expect(names).not.toContain('load_skill')
        expect(names).not.toContain('update_assistant_settings')
        expect(names).not.toContain('update_project_description')
    })
})

describe('AlldoneSimpleMCPServer tools/call routing', () => {
    let originalSetTimeout
    let AlldoneSimpleMCPServer

    beforeAll(() => {
        originalSetTimeout = global.setTimeout
        global.setTimeout = jest.fn(() => 0)
        ;({ AlldoneSimpleMCPServer } = require('./mcpServerSimple'))
    })

    afterAll(() => {
        global.setTimeout = originalSetTimeout
    })

    const buildServer = () => {
        const server = new AlldoneSimpleMCPServer()
        server.getAuthenticatedUserForClient = jest.fn().mockResolvedValue('user-1')
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })
        // Stub the runtime-context builder so the routing test does not need the
        // full user-doc / timezone plumbing.
        server.buildDelegatedToolRuntimeContext = jest.fn().mockResolvedValue({
            sourceChannel: 'mcp',
            userTimezoneOffset: 120,
            language: '',
            objectType: null,
            objectId: null,
        })
        return server
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('delegates a shared tool to executeToolNatively with assistantId=null', async () => {
        const server = buildServer()
        mockExecuteToolNatively.mockResolvedValue({ contacts: [], count: 0 })

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                    name: 'get_contacts',
                    arguments: { projectId: 'project-2', date: 'last week', limit: 25 },
                },
            },
            {}
        )

        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            'get_contacts',
            { projectId: 'project-2', date: 'last week', limit: 25 },
            'project-2',
            null,
            'user-1',
            {},
            {
                sourceChannel: 'mcp',
                userTimezoneOffset: 120,
                language: '',
                objectType: null,
                objectId: null,
            }
        )
        expect(JSON.parse(response.result.content[0].text)).toEqual({ contacts: [], count: 0 })
    })

    test('pins the resolved project for assistant-less create_task with no project args', async () => {
        const server = buildServer()
        server.getUserDefaultProject = jest.fn().mockResolvedValue('default-project')
        mockExecuteToolNatively.mockResolvedValue({ success: true, taskId: 't1' })

        await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: { name: 'create_task', arguments: { name: 'Buy milk' } },
            },
            {}
        )

        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            'create_task',
            { name: 'Buy milk', projectId: 'default-project' },
            'default-project',
            null,
            'user-1',
            {},
            expect.objectContaining({ sourceChannel: 'mcp' })
        )
    })

    test('routes an MCP-only tool to its dedicated handler', async () => {
        const server = buildServer()
        server.getCurrentUserInfo = jest.fn().mockResolvedValue({ userId: 'user-1' })

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: { name: 'get_current_user_info', arguments: {} },
            },
            {}
        )

        expect(server.getCurrentUserInfo).toHaveBeenCalled()
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
        expect(JSON.parse(response.result.content[0].text)).toEqual({ userId: 'user-1' })
    })

    test('returns an error for an unknown tool', async () => {
        const server = buildServer()

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 5,
                method: 'tools/call',
                params: { name: 'does_not_exist', arguments: {} },
            },
            {}
        )

        expect(response.result.isError).toBe(true)
        expect(JSON.parse(response.result.content[0].text).error).toMatch(/Unknown tool/)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
    })
})

describe('AlldoneSimpleMCPServer per-user MCP access', () => {
    let originalSetTimeout
    let AlldoneSimpleMCPServer

    beforeAll(() => {
        originalSetTimeout = global.setTimeout
        global.setTimeout = jest.fn(() => 0)
        ;({ AlldoneSimpleMCPServer } = require('./mcpServerSimple'))
    })

    afterAll(() => {
        global.setTimeout = originalSetTimeout
    })

    const buildServer = access => {
        const server = new AlldoneSimpleMCPServer()
        server.getAuthenticatedUserForClient = jest.fn().mockResolvedValue('user-1')
        server.checkRateLimits = jest.fn().mockResolvedValue({ allowed: true })
        server.getUserMcpAccess = jest.fn().mockResolvedValue(access)
        server.buildDelegatedToolRuntimeContext = jest.fn().mockResolvedValue({ sourceChannel: 'mcp' })
        return server
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    const callTool = (server, name) =>
        server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: { projectId: 'p1' } } },
            {}
        )

    test('tools/list returns no tools when MCP access is disabled', async () => {
        const server = buildServer({ enabled: false, disabledTools: [] })
        const response = await server.handleSingleJsonRpc({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, {})
        expect(response.result.tools).toEqual([])
    })

    test('tools/list omits per-tool disabled tools', async () => {
        const server = buildServer({ enabled: true, disabledTools: ['get_contacts'] })
        const response = await server.handleSingleJsonRpc({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, {})
        const names = response.result.tools.map(tool => tool.name)
        expect(names).not.toContain('get_contacts')
        expect(names).toContain('get_tasks')
    })

    test('tools/call is blocked for every tool when MCP access is disabled', async () => {
        const server = buildServer({ enabled: false, disabledTools: [] })
        const response = await callTool(server, 'get_tasks')
        expect(response.result.isError).toBe(true)
        expect(JSON.parse(response.result.content[0].text).error).toMatch(/disabled/i)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
    })

    test('tools/call blocks a per-tool disabled tool but allows the others', async () => {
        const server = buildServer({ enabled: true, disabledTools: ['get_contacts'] })
        mockExecuteToolNatively.mockResolvedValue({ ok: true })

        const blocked = await callTool(server, 'get_contacts')
        expect(blocked.result.isError).toBe(true)
        expect(JSON.parse(blocked.result.content[0].text).error).toMatch(/disabled/i)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()

        const allowed = await callTool(server, 'get_tasks')
        expect(allowed.result.isError).toBeUndefined()
        expect(mockExecuteToolNatively).toHaveBeenCalledTimes(1)
    })
})
