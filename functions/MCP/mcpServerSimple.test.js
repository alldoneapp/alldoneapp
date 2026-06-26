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
