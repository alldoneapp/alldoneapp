const {
    handleVmMcpRequest,
    buildVmMcpAccess,
    describeVmProjectTools,
    findSharedBrowserTools,
    isAlldoneMcpServerUrl,
    selectVmMcpServers,
    listVmMcpTools,
    mintVmMcpToken,
    verifyVmMcpToken,
    getVmMcpProxyUrl,
    _toolCache,
} = require('./vmMcpProxy')
const { mintProxyToken, verifyProxyToken } = require('./vmLlmProxy')

const SECRET = 'test-signing-secret'
const ENV = { VM_PROXY_SIGNING_SECRET: SECRET, VM_LLM_PROXY_BASE_URL: 'https://proxy.example/vmLlmProxy' }
const NOW = 1_800_000_000_000
const STORY_URL = 'https://alldone.team/mcp'
const ALLDONE_ORIGINS = ['https://my.alldone.app']
const ALLDONE_MCP_URL = 'https://my.alldone.app/mcpServer'
const BROWSER_NAMES = [
    'browser_navigate',
    'browser_inspect',
    'browser_click',
    'browser_type',
    'browser_wait',
    'browser_screenshot',
]

// The browser tools as Alldone's MCP server lists them: each takes the taskId that binds the session.
const alldoneBrowserTool = name => ({
    name,
    description: `${name} in the shared Alldone browser`,
    inputSchema: {
        type: 'object',
        properties: { taskId: { type: 'string' }, url: { type: 'string' } },
    },
})
// Playwright MCP uses the same names for a browser nobody can watch, without taskId.
const playwrightBrowserTool = name => ({
    name,
    description: `${name} (Playwright)`,
    inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
})

const specialist = (id, family, extra = {}) => ({
    id,
    data: {
        allowedTools: ['mcp_servers'],
        mcpServers: [
            {
                id: `alldone-team-${family}`,
                label: 'alldone.team',
                url: STORY_URL,
                authType: 'alldone_app',
                appIds: [family],
                managedBy: 'alldone.team',
            },
        ],
        ...extra,
    },
})

const appTool = (name, app) => ({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    _meta: { 'team.alldone/app': { id: app, name: app === 'story' ? 'Story Builder' : app, summary: `${app} app` } },
})

function fakeDb({ docs = {}, collections = {} } = {}) {
    return {
        doc: path => ({
            get: async () => ({ exists: Object.prototype.hasOwnProperty.call(docs, path), data: () => docs[path] }),
        }),
        collection: path => ({
            get: async () => ({
                docs: (collections[path] || []).map(item => ({ id: item.id, data: () => item.data })),
            }),
        }),
    }
}

function fakeRes() {
    const res = { statusCode: 200, headers: {}, body: undefined, ended: false }
    res.status = code => {
        res.statusCode = code
        return res
    }
    res.json = body => {
        res.body = body
        return res
    }
    res.send = body => {
        res.body = body
        return res
    }
    res.end = () => {
        res.ended = true
        return res
    }
    res.set = (key, value) => {
        res.headers[key] = value
        return res
    }
    return res
}

const fakeReq = ({ method = 'POST', token, body }) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {}
    return { method, body, get: name => headers[String(name).toLowerCase()] }
}

const jobToken = (overrides = {}) =>
    mintVmMcpToken({ correlationId: 'job-1', userId: 'user-1', expiresAtMs: NOW + 60_000, ...overrides }, ENV)

function setup({ job = {}, project = { userIds: ['user-1'] }, assistants = null, tools = null } = {}) {
    _toolCache.clear()
    const db = fakeDb({
        docs: {
            'pendingWebhooks/job-1': {
                kind: 'vm_job',
                userId: 'user-1',
                projectId: 'p1',
                assistantId: 'cto',
                status: 'running',
                ...job,
            },
            ...(project ? { 'projects/p1': project } : {}),
        },
        collections: {
            'assistants/p1/items': assistants || [
                { id: 'cto', data: { allowedTools: ['mcp_servers'], mcpServers: [] } },
                specialist('connor', 'story'),
            ],
        },
    })
    const listTools = jest.fn(
        async () => tools || [appTool('story_create', 'story'), appTool('judy_jobs_list', 'judy')]
    )
    const callTool = jest.fn(async (server, secret, name, args) => ({
        content: [{ type: 'text', text: `${name}:${JSON.stringify(args)}` }],
        structuredContent: { ok: true },
    }))
    const resolveMcpSecret = jest.fn(async ({ authType }) =>
        authType === 'alldone_app' ? { token: 'user-token' } : { token: 'stored' }
    )
    const deps = { mcpClient: { listTools, callTool }, resolveMcpSecret, alldoneMcpOrigins: ALLDONE_ORIGINS }
    const send = async (body, { token = jobToken(), method = 'POST' } = {}) => {
        const res = fakeRes()
        await handleVmMcpRequest(fakeReq({ method, token, body }), res, { db, env: ENV, deps, nowMs: NOW })
        return res
    }
    return { db, deps, listTools, callTool, resolveMcpSecret, send }
}

describe('vmMcpProxy tokens and URL', () => {
    test('a project-tools token is only valid on this proxy, and an LLM token is not valid here', () => {
        const mcpToken = jobToken()
        expect(verifyVmMcpToken(mcpToken, { env: ENV, nowMs: NOW }).valid).toBe(true)
        expect(verifyProxyToken(mcpToken, { expectedAgent: 'claude', env: ENV, nowMs: NOW }).valid).toBe(false)
        expect(verifyProxyToken(mcpToken, { expectedAgent: 'codex', env: ENV, nowMs: NOW }).valid).toBe(false)

        const llmToken = mintProxyToken(
            { correlationId: 'job-1', agent: 'claude', userId: 'user-1', expiresAtMs: NOW + 60_000 },
            ENV
        )
        expect(verifyVmMcpToken(llmToken, { env: ENV, nowMs: NOW })).toEqual({ valid: false, reason: 'agent' })
    })

    test('an expired token is rejected', () => {
        expect(verifyVmMcpToken(jobToken({ expiresAtMs: NOW - 1 }), { env: ENV, nowMs: NOW }).valid).toBe(false)
    })

    test('the URL follows an LLM proxy override and is derived otherwise', () => {
        expect(getVmMcpProxyUrl(ENV)).toBe('https://proxy.example/vmMcpProxy')
        const previous = process.env.GCLOUD_PROJECT
        process.env.GCLOUD_PROJECT = 'alldonestaging'
        try {
            expect(getVmMcpProxyUrl({ VM_PROXY_SIGNING_SECRET: SECRET })).toBe(
                'https://europe-west1-alldonestaging.cloudfunctions.net/vmMcpProxy'
            )
            // An override that is not the LLM proxy's own URL says nothing about this function.
            expect(
                getVmMcpProxyUrl({ VM_PROXY_SIGNING_SECRET: SECRET, VM_LLM_PROXY_BASE_URL: 'https://tunnel.example' })
            ).toBe('https://europe-west1-alldonestaging.cloudfunctions.net/vmMcpProxy')
        } finally {
            if (previous === undefined) delete process.env.GCLOUD_PROJECT
            else process.env.GCLOUD_PROJECT = previous
        }
    })

    test('buildVmMcpAccess mints a token for the job, or gives none without a signing secret', () => {
        const access = buildVmMcpAccess({
            vmJob: { correlationId: 'job-1', requestUserId: 'user-1' },
            ttlMs: 60_000,
            env: ENV,
        })
        expect(access).toMatchObject({ serverName: 'project_tools', url: 'https://proxy.example/vmMcpProxy' })
        expect(verifyVmMcpToken(access.token, { env: ENV }).payload).toMatchObject({ cid: 'job-1', uid: 'user-1' })
        expect(buildVmMcpAccess({ vmJob: { correlationId: 'job-1', requestUserId: 'user-1' }, env: {} })).toBeNull()
    })
})

describe('selectVmMcpServers', () => {
    test("offers the invoking assistant's own servers and every specialist's alldone.team server", () => {
        const servers = selectVmMcpServers(
            [
                {
                    id: 'cto',
                    data: {
                        allowedTools: ['mcp_servers'],
                        mcpServers: [
                            { id: 'linear', label: 'Linear', url: 'https://mcp.linear.app/mcp', authType: 'oauth' },
                            { id: 'off', url: 'https://off.example/mcp', authType: 'bearer', enabled: false },
                        ],
                    },
                },
                specialist('connor', 'story'),
                specialist('judy', 'judy'),
            ],
            'cto'
        )
        expect(servers).toEqual([
            {
                server: { id: 'linear', label: 'Linear', url: 'https://mcp.linear.app/mcp', authType: 'oauth' },
                ownerAssistantId: 'cto',
            },
            {
                server: expect.objectContaining({ url: STORY_URL, authType: 'alldone_app', appIds: ['story', 'judy'] }),
                ownerAssistantId: null,
            },
        ])
    })

    test("never offers another assistant's own servers: their stored credential belongs to that assistant", () => {
        const servers = selectVmMcpServers(
            [
                { id: 'cto', data: { allowedTools: ['mcp_servers'], mcpServers: [] } },
                {
                    id: 'other',
                    data: {
                        allowedTools: ['mcp_servers'],
                        mcpServers: [
                            { id: 'gh', url: 'https://gh.example/mcp', authType: 'bearer' },
                            // alldone_app, but added by hand: not a specialist's managed entry.
                            { id: 'team', url: STORY_URL, authType: 'alldone_app' },
                        ],
                    },
                },
            ],
            'cto'
        )
        expect(servers).toEqual([])
    })

    test('skips assistants whose Tools Access has MCP servers off', () => {
        expect(selectVmMcpServers([specialist('connor', 'story', { allowedTools: [] })], 'cto')).toEqual([])
    })

    test('an alldone.team entry without appIds lifts the app filter for the merged entry', () => {
        const [entry] = selectVmMcpServers(
            [
                {
                    id: 'cto',
                    data: {
                        allowedTools: ['mcp_servers'],
                        mcpServers: [{ id: 'own-team', url: `${STORY_URL}/`, authType: 'alldone_app' }],
                    },
                },
                specialist('connor', 'story'),
            ],
            'cto'
        )
        expect(entry.server.appIds).toBeUndefined()
    })
})

describe('listVmMcpTools', () => {
    test('keeps the app filter, hides view-only tools and prefixes a name two servers share', async () => {
        const listTools = jest.fn(async server =>
            server.id === 'linear'
                ? [{ name: 'story_create', description: 'Linear clash' }, { name: 'list_issues' }]
                : [
                      appTool('story_create', 'story'),
                      appTool('judy_jobs_list', 'judy'),
                      {
                          ...appTool('story_view', 'story'),
                          _meta: { ...appTool('x', 'story')._meta, ui: { visibility: ['app'] } },
                      },
                  ]
        )
        const targets = await listVmMcpTools({
            servers: [
                {
                    server: { id: 'linear', label: 'Linear', url: 'https://mcp.linear.app/mcp', authType: 'oauth' },
                    ownerAssistantId: 'cto',
                },
                {
                    server: {
                        id: 'team',
                        label: 'alldone.team',
                        url: STORY_URL,
                        authType: 'alldone_app',
                        appIds: ['story'],
                    },
                    ownerAssistantId: null,
                },
            ],
            projectId: 'p1',
            requestUserId: 'user-1',
            deps: { mcpClient: { listTools }, resolveMcpSecret: async () => ({ token: 't' }) },
        })
        expect(targets.map(target => target.name)).toEqual([
            'linear__story_create',
            'list_issues',
            'alldone_team__story_create',
        ])
        expect(targets[2]).toMatchObject({ remoteName: 'story_create', appName: 'Story Builder' })
    })

    test('a server that fails to list is skipped', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const targets = await listVmMcpTools({
            servers: [
                {
                    server: { id: 'broken', url: 'https://broken.example/mcp', authType: 'none' },
                    ownerAssistantId: 'cto',
                },
            ],
            projectId: 'p1',
            requestUserId: 'user-1',
            deps: {
                mcpClient: { listTools: async () => Promise.reject(new Error('down')) },
                resolveMcpSecret: async () => null,
            },
        })
        expect(targets).toEqual([])
        warn.mockRestore()
    })
})

describe('describeVmProjectTools', () => {
    test("names the apps the run gets, from the project's specialists", async () => {
        const { db, deps } = setup()
        const context = await describeVmProjectTools({
            projectId: 'p1',
            assistantId: 'cto',
            requestUserId: 'user-1',
            db,
            deps,
        })
        expect(context).toEqual({
            enabled: true,
            serverName: 'project_tools',
            toolCount: 1,
            apps: [{ name: 'Story Builder', summary: 'story app', toolCount: 1 }],
            sharedBrowser: null,
        })
    })

    const ctoWithServer = (url, extra = {}) => [
        {
            id: 'cto',
            data: {
                allowedTools: ['mcp_servers'],
                mcpServers: [{ id: 'own', label: 'Own', url, authType: 'bearer', ...extra }],
            },
        },
    ]

    test("reports the shared browser when Alldone's MCP server offers the browser tools", async () => {
        const { db, deps } = setup({
            assistants: ctoWithServer(ALLDONE_MCP_URL),
            tools: [...BROWSER_NAMES.map(alldoneBrowserTool), appTool('get_tasks', 'alldone')],
        })
        const context = await describeVmProjectTools({
            projectId: 'p1',
            assistantId: 'cto',
            requestUserId: 'user-1',
            db,
            deps,
        })
        expect(context.sharedBrowser).toEqual({ toolNames: BROWSER_NAMES })
        expect(context.toolCount).toBe(7)
    })

    test('reports no shared browser when only other MCP tools are there, even ones called browser_*', async () => {
        const { db, deps } = setup({
            assistants: ctoWithServer('https://playwright.example/mcp'),
            tools: BROWSER_NAMES.map(playwrightBrowserTool),
        })
        const context = await describeVmProjectTools({
            projectId: 'p1',
            assistantId: 'cto',
            requestUserId: 'user-1',
            db,
            deps,
        })
        expect(context.enabled).toBe(true)
        expect(context.sharedBrowser).toBeNull()
    })

    test('is null when the project offers no tools', async () => {
        const { db, deps } = setup({ assistants: [{ id: 'cto', data: { allowedTools: [] } }] })
        expect(
            await describeVmProjectTools({ projectId: 'p1', assistantId: 'cto', requestUserId: 'user-1', db, deps })
        ).toBeNull()
    })
})

describe('findSharedBrowserTools (AT-3141)', () => {
    const target = (remoteName, { url = ALLDONE_MCP_URL, name = remoteName, tool = null } = {}) => ({
        name,
        remoteName,
        server: { id: 'own', url },
        definition: { name, inputSchema: (tool || alldoneBrowserTool(remoteName)).inputSchema },
    })

    test("finds the complete browser family on Alldone's own MCP server, under the names the agent sees", () => {
        const targets = BROWSER_NAMES.map(name =>
            target(name, { name: name === 'browser_click' ? 'alldone__browser_click' : name })
        )
        expect(findSharedBrowserTools(targets, ALLDONE_ORIGINS)).toEqual({
            toolNames: BROWSER_NAMES.map(name => (name === 'browser_click' ? 'alldone__browser_click' : name)),
        })
    })

    test('no tools at all means no shared browser', () => {
        expect(findSharedBrowserTools([], ALLDONE_ORIGINS)).toBeNull()
        expect(findSharedBrowserTools(undefined, ALLDONE_ORIGINS)).toBeNull()
    })

    test('a browser_* family on another server is not the shared browser', () => {
        const targets = BROWSER_NAMES.map(name => target(name, { url: 'https://playwright.example/mcp' }))
        expect(findSharedBrowserTools(targets, ALLDONE_ORIGINS)).toBeNull()
    })

    test('tools without taskId cannot be bound to the task and do not count', () => {
        const targets = BROWSER_NAMES.map(name => target(name, { tool: playwrightBrowserTool(name) }))
        expect(findSharedBrowserTools(targets, ALLDONE_ORIGINS)).toBeNull()
    })

    test('a partial family fails closed', () => {
        const targets = BROWSER_NAMES.filter(name => name !== 'browser_inspect').map(name => target(name))
        expect(findSharedBrowserTools(targets, ALLDONE_ORIGINS)).toBeNull()
    })

    test("Alldone's MCP endpoint is matched by origin and path, not by host name alone", () => {
        expect(isAlldoneMcpServerUrl('https://my.alldone.app/mcpServer', ALLDONE_ORIGINS)).toBe(true)
        expect(isAlldoneMcpServerUrl('https://my.alldone.app/mcpServer/', ALLDONE_ORIGINS)).toBe(true)
        expect(isAlldoneMcpServerUrl('https://my.alldone.app/other', ALLDONE_ORIGINS)).toBe(false)
        expect(isAlldoneMcpServerUrl('https://my.alldone.app.evil.example/mcpServer', ALLDONE_ORIGINS)).toBe(false)
        expect(isAlldoneMcpServerUrl('http://my.alldone.app/mcpServer', ALLDONE_ORIGINS)).toBe(false)
        expect(isAlldoneMcpServerUrl('not a url', ALLDONE_ORIGINS)).toBe(false)
        expect(isAlldoneMcpServerUrl(ALLDONE_MCP_URL, [])).toBe(false)
    })
})

describe('handleVmMcpRequest', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => jest.restoreAllMocks())

    test('rejects a request without a valid token', async () => {
        const { send } = setup()
        expect((await send({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: '' })).statusCode).toBe(401)
        const llmToken = mintProxyToken(
            { correlationId: 'job-1', agent: 'claude', userId: 'user-1', expiresAtMs: NOW + 60_000 },
            ENV
        )
        expect((await send({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: llmToken })).statusCode).toBe(401)
    })

    test("rejects a token for another user's job, a finished job, and a user who left the project", async () => {
        expect(
            (await setup().send({ jsonrpc: '2.0', id: 1, method: 'ping' }, { token: jobToken({ userId: 'mallory' }) }))
                .statusCode
        ).toBe(403)
        expect(
            (await setup({ job: { status: 'completed' } }).send({ jsonrpc: '2.0', id: 1, method: 'ping' })).statusCode
        ).toBe(403)
        expect(
            (await setup({ project: { userIds: ['someone-else'] } }).send({ jsonrpc: '2.0', id: 1, method: 'ping' }))
                .statusCode
        ).toBe(403)
    })

    test('answers GET with 405 (no server stream) and a notification with 202', async () => {
        const { send } = setup()
        const getRes = await send(undefined, { method: 'GET' })
        expect(getRes.statusCode).toBe(405)
        expect(getRes.headers.Allow).toBe('POST')
        const noteRes = await send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        expect(noteRes.statusCode).toBe(202)
        expect(noteRes.ended).toBe(true)
    })

    test('initialize returns tool capabilities and the requested protocol version', async () => {
        const res = await setup().send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-03-26' },
        })
        expect(res.body).toMatchObject({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } } },
        })
    })

    test("tools/list offers the specialist's own app only, listed as the requesting user", async () => {
        const { send, resolveMcpSecret } = setup()
        const res = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
        expect(res.body.result.tools.map(tool => tool.name)).toEqual(['story_create'])
        expect(res.body.result.tools[0]).toMatchObject({ inputSchema: { type: 'object' } })
        expect(res.body.result.tools[0]._meta).toBeUndefined()
        expect(resolveMcpSecret).toHaveBeenCalledWith(
            expect.objectContaining({ authType: 'alldone_app', requestUserId: 'user-1', serverUrl: STORY_URL })
        )
    })

    test('tools/call runs the remote tool and returns its result', async () => {
        const { send, callTool } = setup()
        const res = await send({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'story_create', arguments: { id: 'x' } },
        })
        expect(callTool).toHaveBeenCalledWith(
            expect.objectContaining({ url: STORY_URL, appIds: ['story'] }),
            { token: 'user-token' },
            'story_create',
            { id: 'x' }
        )
        expect(res.body.result).toEqual({
            content: [{ type: 'text', text: 'story_create:{"id":"x"}' }],
            structuredContent: { ok: true },
        })
    })

    test('a tool outside the run, or a failing call, comes back as a tool error', async () => {
        const { send, callTool } = setup()
        const unknown = await send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'judy_jobs_list' } })
        expect(unknown.body.result).toMatchObject({ isError: true })
        expect(callTool).not.toHaveBeenCalled()

        callTool.mockRejectedValueOnce(new Error('upstream 500'))
        const failed = await send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'story_create' } })
        expect(failed.body.result).toMatchObject({ isError: true })
        expect(failed.body.result.content[0].text).toContain('upstream 500')
    })

    test('lists the tools once per job and minute, not on every call', async () => {
        const { send, listTools } = setup()
        await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'story_create' } })
        expect(listTools).toHaveBeenCalledTimes(1)
    })

    test('answers a batch with a batch and an unknown method with -32601', async () => {
        const res = await setup().send([
            { jsonrpc: '2.0', id: 1, method: 'ping' },
            { jsonrpc: '2.0', method: 'notifications/initialized' },
            { jsonrpc: '2.0', id: 2, method: 'resources/list' },
        ])
        expect(res.body).toEqual([
            { jsonrpc: '2.0', id: 1, result: {} },
            { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method not found: resources/list' } },
        ])
    })
})
