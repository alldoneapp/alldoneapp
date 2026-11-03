const { readToolUi, recordMcpAppView, handleMcpAppRequest, McpAppError, findViewServer } = require('./mcpAppViews')

const VIEW_ID = 'a'.repeat(32)
const view = {
    viewId: VIEW_ID,
    userId: 'me',
    projectId: 'project',
    assistantId: 'anna',
    serverId: 'team',
    serverLabel: 'alldone.team',
    serverUrl: 'https://alldone.team/mcp',
    serverTransport: 'http',
    serverAuthType: 'alldone_app',
    appName: 'Judy Job',
    toolName: 'judy_show',
    resourceUri: 'ui://judy/workspace.html',
    toolArguments: { view: 'matches' },
    toolResult: { content: [], structuredContent: { total: 2 }, isError: false },
}
const server = { id: 'team', label: 'alldone.team', url: 'https://alldone.team/mcp', authType: 'alldone_app' }
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
        getAssistant: jest.fn(async () => ({ displayName: 'Anna Alldone', mcpServers: [server] })),
        updateView: jest.fn(async () => {}),
        connectServer: jest.fn(async () => ({ success: true })),
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
        serverConfig: { url: 'https://alldone.team/mcp', transport: 'http', authType: 'alldone_app' },
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
                serverUrl: 'https://alldone.team/mcp',
                serverTransport: 'http',
                serverAuthType: 'alldone_app',
            })
        )
        // The address only: nothing secret about the connection is ever kept on the view.
        expect(Object.keys(set.mock.calls[0][1]).filter(key => /token|secret/i.test(key))).toEqual([])
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

    test('lets a specialist’s view reach only its own app’s tools', async () => {
        const app = id => ({ 'team.alldone/app': { id, name: id, summary: '' } })
        const d = deps({
            getAssistant: jest.fn(async () => ({ mcpServers: [{ ...server, appIds: ['story'] }] })),
            listTools: jest.fn(async () => [
                { name: 'story_view_get', _meta: { ui: { visibility: ['app'] }, ...app('story') } },
                { name: 'judy_view_get', _meta: { ui: { visibility: ['app'] }, ...app('judy') } },
            ]),
        })
        await handleMcpAppRequest(request({ action: 'callTool', name: 'story_view_get' }), d)
        await rejectsWith(
            handleMcpAppRequest(request({ action: 'callTool', name: 'judy_view_get' }), d),
            'permission-denied'
        )
        expect(d.callTool.mock.calls.map(call => call[2])).toEqual(['story_view_get'])
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
            handleMcpAppRequest(
                request({ action: 'resource' }),
                deps({ getAssistant: async () => ({ mcpServers: [] }) })
            ),
            'failed-precondition'
        )
    })

    test('reads only the view’s own resource', async () => {
        const d = deps()
        await handleMcpAppRequest(request({ action: 'resource', uri: 'ui://other/secret.html' }), d)
        expect(d.readResource).toHaveBeenCalledWith(server, { token: 'adapp_me' }, 'ui://judy/workspace.html')
    })
})

describe('reopening a view whose server was removed from the assistant (AT-2952)', () => {
    const removed = () => deps({ getAssistant: jest.fn(async () => ({ displayName: 'Anna Alldone', mcpServers: [] })) })
    const failure = async promise => {
        try {
            await promise
        } catch (error) {
            return error
        }
        throw new Error('expected the request to fail')
    }

    test('says why, names the app and the assistant, and offers to connect it again', async () => {
        const error = await failure(handleMcpAppRequest(request({ action: 'resource' }), removed()))
        expect(error.code).toBe('failed-precondition')
        expect(error.details).toEqual({
            reason: 'server_disconnected',
            appName: 'Judy Job',
            serverLabel: 'alldone.team',
            assistantName: 'Anna Alldone',
            canReconnect: true,
            reconnectBlocker: null,
        })
    })

    test('opens a view on the same server added again under a new id', async () => {
        const readded = { ...server, id: 'team-new', label: 'Team' }
        const d = deps({ getAssistant: jest.fn(async () => ({ mcpServers: [readded] })) })
        await expect(handleMcpAppRequest(request({ action: 'resource' }), d)).resolves.toMatchObject({
            html: '<html>judy</html>',
        })
        expect(d.readResource).toHaveBeenCalledWith(readded, { token: 'adapp_me' }, view.resourceUri)
        expect(d.resolveMcpSecret).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'team-new' }))
    })

    test('never borrows a server at the same address with another sign-in, or a disabled one', () => {
        const bearer = { ...server, id: 'owner', authType: 'bearer' }
        expect(findViewServer([bearer], view)).toBeNull()
        expect(
            findViewServer(
                [{ ...server, id: 'x', enabled: false }].filter(s => s.enabled !== false),
                view
            )
        ).toBeNull()
        expect(findViewServer([{ ...server, id: 'x', url: 'https://other.example/mcp' }], view)).toBeNull()
    })

    test('a view from before the address was kept finds the only server with its label, and learns its address', async () => {
        const legacy = { ...view, serverUrl: undefined, serverTransport: undefined, serverAuthType: undefined }
        const readded = { ...server, id: 'team-new', label: ' Alldone.team ' }
        const d = deps({ getView: async () => legacy, getAssistant: async () => ({ mcpServers: [readded] }) })
        await handleMcpAppRequest(request({ action: 'resource' }), d)
        expect(d.updateView).toHaveBeenCalledWith(VIEW_ID, {
            serverUrl: 'https://alldone.team/mcp',
            serverTransport: 'http',
            serverAuthType: 'alldone_app',
        })
        // Two servers with that label: not a guess it may make.
        expect(findViewServer([readded, { ...readded, id: 'other' }], legacy)).toBeNull()
    })

    test('reconnecting connects the view’s own server once, under its original id, as the person', async () => {
        const d = removed()
        await expect(handleMcpAppRequest(request({ action: 'reconnect' }), d)).resolves.toEqual({
            reconnected: true,
            alreadyConnected: false,
        })
        expect(d.connectServer).toHaveBeenCalledTimes(1)
        expect(d.connectServer).toHaveBeenCalledWith({
            userId: 'me',
            projectId: 'project',
            assistantId: 'anna',
            server: {
                id: 'team',
                label: 'alldone.team',
                url: 'https://alldone.team/mcp',
                transport: 'http',
                authType: 'alldone_app',
            },
        })
        expect(d.resolveMcpSecret).not.toHaveBeenCalled()
    })

    test('a second click once the server is back changes nothing', async () => {
        const d = deps()
        await expect(handleMcpAppRequest(request({ action: 'reconnect' }), d)).resolves.toEqual({
            reconnected: false,
            alreadyConnected: true,
        })
        expect(d.connectServer).not.toHaveBeenCalled()
    })

    test('offers no one-click reconnect where it would need a secret, an address or an admin', async () => {
        const cases = [
            [{ serverAuthType: 'bearer' }, 'needs_credentials'],
            [{ serverAuthType: 'oauth' }, 'needs_credentials'],
            [{ serverUrl: undefined }, 'unknown_server'],
            [{ projectId: 'globalProject' }, 'not_allowed'],
        ]
        for (const [change, blocker] of cases) {
            const d = deps({
                getView: async () => ({ ...view, ...change }),
                getAssistant: async () => ({ mcpServers: [] }),
            })
            const error = await failure(handleMcpAppRequest(request({ action: 'reconnect' }), d))
            expect(error.details).toMatchObject({ canReconnect: false, reconnectBlocker: blocker })
            expect(d.connectServer).not.toHaveBeenCalled()
        }
    })

    test('nobody can reconnect somebody else’s view, or one in a project they left', async () => {
        const d = removed()
        await rejectsWith(handleMcpAppRequest(request({ action: 'reconnect' }, 'other'), d), 'not-found')
        await rejectsWith(
            handleMcpAppRequest(request({ action: 'reconnect' }), { ...d, isProjectMember: async () => false }),
            'permission-denied'
        )
        expect(d.connectServer).not.toHaveBeenCalled()
    })
})

test('errors carry a callable code', () => {
    expect(new McpAppError('not-found', 'x').code).toBe('not-found')
})
