const { readToolUi, recordMcpAppView, handleMcpAppRequest, McpAppError } = require('./mcpAppViews')

const VIEW_ID = 'a'.repeat(32)
const view = {
    viewId: VIEW_ID,
    userId: 'me',
    projectId: 'project',
    assistantId: 'anna',
    serverId: 'team',
    serverLabel: 'alldone.team',
    toolName: 'judy_show',
    resourceUri: 'ui://judy/workspace.html',
    toolArguments: { view: 'matches' },
    toolResult: { content: [], structuredContent: { total: 2 }, isError: false },
}
const server = { id: 'team', url: 'https://alldone.team/mcp', authType: 'alldone_app' }
const tools = [
    { name: 'judy_show', _meta: { ui: { resourceUri: 'ui://judy/workspace.html' } } },
    { name: 'judy_view_get', _meta: { ui: { visibility: ['app'] } } },
    { name: 'judy_model_only', _meta: { ui: { visibility: ['model'] } } },
    { name: 'judy_jobs_list' },
]

function deps(overrides = {}) {
    return {
        getView: jest.fn(async () => view),
        isProjectMember: jest.fn(async () => true),
        getAssistantMcpServers: jest.fn(async () => [server]),
        resolveMcpSecret: jest.fn(async () => ({ token: 'adapp_me' })),
        readResource: jest.fn(async () => ({
            contents: [
                {
                    uri: 'ui://judy/workspace.html',
                    text: '<html>judy</html>',
                    _meta: { ui: { csp: { connectDomains: [] }, prefersBorder: true } },
                },
            ],
        })),
        listTools: jest.fn(async () => tools),
        callTool: jest.fn(async (_server, _secret, name) => ({ content: [], structuredContent: { tool: name } })),
        ...overrides,
    }
}
const request = (data, uid = 'me') => ({ uid, data: { viewId: VIEW_ID, ...data } })
const rejectsWith = (promise, code) => expect(promise).rejects.toMatchObject({ code })

describe('reading the view a tool declares', () => {
    test('takes the resource and visibility from the current and the legacy key', () => {
        expect(readToolUi(tools[0])).toEqual({ resourceUri: 'ui://judy/workspace.html', visibility: null })
        expect(readToolUi({ _meta: { 'ui/resourceUri': 'ui://x/y.html' } }).resourceUri).toBe('ui://x/y.html')
        expect(readToolUi(tools[1]).visibility).toEqual(['app'])
        expect(readToolUi({ _meta: { ui: { resourceUri: 'https://evil.example/x' } } }).resourceUri).toBeNull()
        expect(readToolUi({ name: 'plain' })).toEqual({ resourceUri: null, visibility: null })
    })
})

describe('recording a view under the assistant answer', () => {
    const target = {
        serverId: 'team',
        serverLabel: 'alldone.team',
        remoteToolName: 'judy_show',
        uiResourceUri: view.resourceUri,
    }

    test('stores it for the person the run acted for, under the answer', async () => {
        const set = jest.fn(async () => {})
        const db = { collection: () => ({ doc: id => ({ set: data => set(id, data) }) }) }
        const viewId = await recordMcpAppView({
            db,
            target,
            toolArgs: { view: 'matches' },
            result: { content: [], structuredContent: { total: 2 } },
            toolRuntimeContext: { assistantCommentId: 'comment-1', objectType: 'topics', objectId: 'chat-1' },
            projectId: 'project',
            assistantId: 'anna',
            requestUserId: 'me',
        })
        expect(viewId).toMatch(/^[a-f0-9]{32}$/)
        expect(set).toHaveBeenCalledWith(
            viewId,
            expect.objectContaining({
                userId: 'me',
                assistantCommentId: 'comment-1',
                resourceUri: 'ui://judy/workspace.html',
                toolResult: { content: [], structuredContent: { total: 2 }, isError: false },
            })
        )
    })

    test('keeps no oversized result, and records nothing without an answer to hang it under', async () => {
        const set = jest.fn(async () => {})
        const db = { collection: () => ({ doc: () => ({ set }) }) }
        const huge = { content: [{ type: 'text', text: 'x'.repeat(300 * 1024) }] }
        await recordMcpAppView({
            db,
            target,
            result: huge,
            toolRuntimeContext: { assistantCommentId: 'c' },
            projectId: 'p',
            assistantId: 'a',
            requestUserId: 'me',
        })
        expect(set.mock.calls[0][0].toolResult).toBeNull()
        await expect(
            recordMcpAppView({
                db,
                target,
                result: {},
                toolRuntimeContext: {},
                projectId: 'p',
                assistantId: 'a',
                requestUserId: 'me',
            })
        ).resolves.toBeNull()
    })
})

describe('the browser asking for a view', () => {
    test('serves the view HTML with its own CSP and the result it opened with', async () => {
        const result = await handleMcpAppRequest(request({ action: 'resource' }), deps())
        expect(result).toMatchObject({
            html: '<html>judy</html>',
            csp: { connectDomains: [] },
            prefersBorder: true,
            toolName: 'judy_show',
            toolResult: view.toolResult,
        })
    })

    test('runs a tool the server lets the app call, with the person’s own secret', async () => {
        const d = deps()
        await handleMcpAppRequest(
            request({ action: 'callTool', name: 'judy_view_get', arguments: { view: 'matches' } }),
            d
        )
        await handleMcpAppRequest(request({ action: 'callTool', name: 'judy_jobs_list' }), d)
        expect(d.resolveMcpSecret).toHaveBeenCalledWith(
            expect.objectContaining({ requestUserId: 'me', serverId: 'team' })
        )
        expect(d.callTool.mock.calls.map(call => call[2])).toEqual(['judy_view_get', 'judy_jobs_list'])
    })

    test('refuses a tool the server keeps for the model, or one it does not have', async () => {
        await rejectsWith(
            handleMcpAppRequest(request({ action: 'callTool', name: 'judy_model_only' }), deps()),
            'permission-denied'
        )
        await rejectsWith(
            handleMcpAppRequest(request({ action: 'callTool', name: 'nope' }), deps()),
            'permission-denied'
        )
    })

    test('answers somebody else’s view like a missing one, and drops a person who left the project', async () => {
        await rejectsWith(handleMcpAppRequest(request({ action: 'resource' }, 'other'), deps()), 'not-found')
        await rejectsWith(
            handleMcpAppRequest(request({ action: 'resource' }), deps({ getView: async () => null })),
            'not-found'
        )
        await rejectsWith(
            handleMcpAppRequest(request({ action: 'resource' }), deps({ isProjectMember: async () => false })),
            'permission-denied'
        )
        await rejectsWith(handleMcpAppRequest({ uid: null, data: {} }, deps()), 'unauthenticated')
    })

    test('stops working once the server is no longer on the assistant', async () => {
        await rejectsWith(
            handleMcpAppRequest(request({ action: 'resource' }), deps({ getAssistantMcpServers: async () => [] })),
            'failed-precondition'
        )
    })

    test('reads only the view’s own resource', async () => {
        const d = deps()
        await handleMcpAppRequest(request({ action: 'resource', uri: 'ui://other/secret.html' }), d)
        expect(d.readResource).toHaveBeenCalledWith(server, { token: 'adapp_me' }, 'ui://judy/workspace.html')
    })
})

test('errors carry a callable code', () => {
    expect(new McpAppError('not-found', 'x').code).toBe('not-found')
})
