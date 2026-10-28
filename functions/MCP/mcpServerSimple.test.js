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

    test('tells every client that Alldone is the system of record, naming only tools it serves (AT-2832)', async () => {
        const { SYSTEM_OF_RECORD_TOOL_NAMES, SYSTEM_OF_RECORD_INSTRUCTIONS } = require('./mcpAgentInstructions')
        const server = new AlldoneSimpleMCPServer()
        server.getAuthenticatedUserForClient = jest.fn().mockResolvedValue({ userId: 'user-1' })
        server.rememberMcpClientName = jest.fn().mockResolvedValue(undefined)
        const response = await server.handleSingleJsonRpc(
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } },
            { headers: {} }
        )
        expect(response.result.instructions).toContain(SYSTEM_OF_RECORD_INSTRUCTIONS)
        expect(response.result.instructions).toMatch(/system of record/)
        expect(response.result.instructions).toMatch(/AUTHENTICATION REQUIRED/)

        const served = new Set((await listTools()).map(tool => tool.name))
        for (const name of SYSTEM_OF_RECORD_TOOL_NAMES) {
            expect(served.has(name)).toBe(true)
        }
        // Every tool name the text mentions is in the list the check above covers.
        const mentioned = SYSTEM_OF_RECORD_INSTRUCTIONS.match(/\b[a-z]+(?:_[a-z]+)+\b|\bsearch\b/g)
        expect(new Set(mentioned)).toEqual(new Set(SYSTEM_OF_RECORD_TOOL_NAMES))
    })

    test('exposes the four project artifact tools from the shared assistant schemas', async () => {
        const tools = await listTools()
        for (const name of ['get_artifacts', 'read_artifact', 'create_artifact', 'update_artifact']) {
            expect(tools.find(entry => entry.name === name)).toBeDefined()
        }
        const create = tools.find(entry => entry.name === 'create_artifact')
        expect(create.inputSchema.required).toEqual(['title', 'files'])
        expect(create.inputSchema.properties.projectId.type).toBe('string')
    })

    test('exposes the three project wiki tools, described for a client without an assistant', async () => {
        const tools = await listTools()
        const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]))
        for (const name of ['read_knowledge_page', 'correct_knowledge_page', 'undo_knowledge_correction']) {
            expect(byName[name]).toBeDefined()
            // An MCP client has no conversation, so the default is the user's default project.
            expect(byName[name].inputSchema.properties.projectId.description).toMatch(/get_user_projects/)
            expect(byName[name].inputSchema.properties.projectId.description).not.toMatch(/conversation/)
        }
        // ...and no page index in its instructions: it lists the pages with the same tool.
        expect(byName.read_knowledge_page.description).toMatch(/without a slug first/)
        expect(byName.read_knowledge_page.description).not.toMatch(/in your instructions/)
        expect(byName.correct_knowledge_page.inputSchema.required).toEqual(['slug', 'revision', 'correction', 'body'])
        expect(byName.undo_knowledge_correction.inputSchema.required).toEqual(['correctionId'])
    })

    test('leaves the shared wiki schemas untouched for the in-app assistant', async () => {
        const { toolSchemas } = require('../Assistant/toolSchemas')
        const originalSchema = JSON.parse(JSON.stringify(toolSchemas.read_knowledge_page))
        await listTools()
        expect(toolSchemas.read_knowledge_page).toEqual(originalSchema)
        expect(toolSchemas.read_knowledge_page.function.parameters.properties.projectId.description).toMatch(
            /conversation/
        )
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

    test('exposes the task origin and direct user assignment contract for create_task', async () => {
        const tool = (await listTools()).find(entry => entry.name === 'create_task')

        expect(tool.description).toContain('only when the end user explicitly asked')
        expect(tool.description).toContain('automation instruction')
        expect(tool.description).toContain('assigned directly to the user')
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
        server.getUserProjectList = jest.fn().mockResolvedValue([{ id: 'project-2', name: 'Project 2' }])
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

    test('refuses an explicit projectId the caller is not a member of before any tool runs', async () => {
        // Every delegated tool writes through the Admin SDK, so this is the only point where a
        // foreign project id can be stopped for all of them at once.
        const server = buildServer()

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 6,
                method: 'tools/call',
                params: { name: 'create_task', arguments: { name: 'Plant', projectId: 'foreign-project' } },
            },
            {}
        )

        expect(server.getUserProjectList).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({ includeArchived: true, includeCommunity: true, activeOnly: false })
        )
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
        expect(response.result.isError).toBe(true)
        expect(JSON.parse(response.result.content[0].text).error).toContain(
            'Target project not found or not accessible: "foreign-project"'
        )
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

    test('runs a wiki tool through executeToolNatively in the requested project', async () => {
        const server = buildServer()
        mockExecuteToolNatively.mockResolvedValue({ success: true, pages: [] })

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 6,
                method: 'tools/call',
                params: { name: 'read_knowledge_page', arguments: { projectId: 'project-2' } },
            },
            {}
        )

        expect(response.result.isError).toBeUndefined()
        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            'read_knowledge_page',
            { projectId: 'project-2' },
            'project-2',
            null,
            'user-1',
            {},
            expect.objectContaining({ sourceChannel: 'mcp' })
        )
    })

    test('asks for a project instead of running a wiki tool without one', async () => {
        const server = buildServer()
        server.getUserDefaultProject = jest.fn().mockResolvedValue(null)

        const response = await server.handleSingleJsonRpc(
            {
                jsonrpc: '2.0',
                id: 7,
                method: 'tools/call',
                params: { name: 'read_knowledge_page', arguments: {} },
            },
            {}
        )

        expect(response.result.isError).toBe(true)
        expect(JSON.parse(response.result.content[0].text).error).toMatch(/projectId/)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()
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
        server.getUserProjectList = jest.fn().mockResolvedValue([{ id: 'p1', name: 'Project 1' }])
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

    test('correcting the wiki can be switched off while reading and undoing stay available', async () => {
        const server = buildServer({ enabled: true, disabledTools: ['correct_knowledge_page'] })
        mockExecuteToolNatively.mockResolvedValue({ success: true })

        const listed = await server.handleSingleJsonRpc({ jsonrpc: '2.0', id: 8, method: 'tools/list' }, {})
        const names = listed.result.tools.map(tool => tool.name)
        expect(names).not.toContain('correct_knowledge_page')
        expect(names).toContain('read_knowledge_page')
        expect(names).toContain('undo_knowledge_correction')

        const blocked = await callTool(server, 'correct_knowledge_page')
        expect(blocked.result.isError).toBe(true)
        expect(JSON.parse(blocked.result.content[0].text).error).toMatch(/disabled/i)
        expect(mockExecuteToolNatively).not.toHaveBeenCalled()

        const read = await callTool(server, 'read_knowledge_page')
        expect(read.result.isError).toBeUndefined()
        expect(mockExecuteToolNatively).toHaveBeenCalledWith(
            'read_knowledge_page',
            expect.anything(),
            'p1',
            null,
            'user-1',
            {},
            expect.objectContaining({ sourceChannel: 'mcp' })
        )
    })
})

describe('MCP rate limits', () => {
    // Enough of Firestore for the limiter: one collection of counter documents.
    function createCounterStore() {
        const documents = new Map()
        return {
            documents,
            collection: () => ({
                doc: id => ({
                    get: async () => ({ exists: documents.has(id), data: () => documents.get(id) }),
                    set: async data => {
                        documents.set(id, { ...(documents.get(id) || {}), ...data })
                    },
                }),
            }),
        }
    }

    function countOf(store, keyPrefix) {
        return [...store.documents.entries()]
            .filter(
                ([id]) => id.startsWith(`${keyPrefix}:`) && id.split(':').length === keyPrefix.split(':').length + 1
            )
            .reduce((sum, [, data]) => sum + (data.count || 0), 0)
    }

    function buildRateLimitedServer(store) {
        const { AlldoneSimpleMCPServer, RateLimiter } = require('./mcpServerSimple')
        const server = Object.create(AlldoneSimpleMCPServer.prototype)
        server.rateLimiter = new RateLimiter(store)
        server.triggerPeriodicCleanup = jest.fn()
        return server
    }

    const toolRequest = { ip: '160.79.104.10', headers: { authorization: 'Bearer token-of-one-claude-connection' } }

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    test('lets an agent burst through an ordinary multi-step request', async () => {
        const server = buildRateLimitedServer(createCounterStore())

        // Look up the projects, search for duplicates, create five tasks: seven calls in a minute.
        for (let call = 0; call < 7; call++) {
            await expect(server.checkRateLimits(toolRequest, 'TOOL_CALLS', 'user-1')).resolves.toEqual({
                allowed: true,
            })
        }
    })

    test('still refuses a token past its per-minute budget', async () => {
        const { RATE_LIMITS } = require('./mcpServerSimple')
        const server = buildRateLimitedServer(createCounterStore())

        for (let call = 0; call < RATE_LIMITS.TOOL_CALLS_MINUTE.limit; call++) {
            await server.checkRateLimits(toolRequest, 'TOOL_CALLS', 'user-1')
        }
        const refused = await server.checkRateLimits(toolRequest, 'TOOL_CALLS', 'user-1')

        expect(refused.allowed).toBe(false)
        expect(refused.errorResponse.error.message).toBe('Rate limit exceeded')
    })

    test('does not count a refused request against the windows that allowed it', async () => {
        const { RateLimiter } = require('./mcpServerSimple')
        const store = createCounterStore()
        const limiter = new RateLimiter(store)
        const checks = [
            { key: 'client:t:minute', limit: 1, windowMs: 60 * 1000 },
            { key: 'client:t:10min', limit: 100, windowMs: 10 * 60 * 1000 },
        ]

        await limiter.checkMultipleLimits(checks)
        const retries = []
        for (let retry = 0; retry < 5; retry++) retries.push(await limiter.checkMultipleLimits(checks))

        expect(retries.every(result => result.allowed === false)).toBe(true)
        expect(countOf(store, 'client:t:minute')).toBe(1)
        expect(countOf(store, 'client:t:10min')).toBe(1)
    })

    test('does not make signed-in tool calls share one budget per egress address', async () => {
        const store = createCounterStore()
        const server = buildRateLimitedServer(store)

        await server.checkRateLimits(toolRequest, 'TOOL_CALLS', 'user-1')
        expect(countOf(store, `ip:${toolRequest.ip}`)).toBe(0)

        await server.checkRateLimits(toolRequest, 'TOOL_CALLS', null)
        expect(countOf(store, `ip:${toolRequest.ip}`)).toBe(1)
    })

    test('fails open when the counters cannot be read', async () => {
        const { RateLimiter } = require('./mcpServerSimple')
        const limiter = new RateLimiter({
            collection: () => ({
                doc: () => ({
                    get: async () => {
                        throw new Error('firestore unavailable')
                    },
                }),
            }),
        })
        jest.spyOn(console, 'error').mockImplementation(() => {})

        await expect(limiter.checkMultipleLimits([{ key: 'k', limit: 1, windowMs: 1000 }])).resolves.toMatchObject({
            allowed: true,
        })
        await expect(limiter.checkLimit('k', 1, 1000)).resolves.toMatchObject({ allowed: true })
    })
})
