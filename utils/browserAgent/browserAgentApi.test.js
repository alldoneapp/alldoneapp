import {
    AGENT_API_MANIFEST_ID,
    AGENT_API_STATES,
    AlldoneToolError,
    BROWSER_AGENT_CLIENT_HEADER,
    BROWSER_AGENT_CLIENT_NAME,
    BROWSER_AGENT_READY_EVENT,
    createMcpSessionClient,
    getMcpServerEndpoint,
    getModelContext,
    getToolAnnotations,
    installBrowserAgentApi,
    installWindowApi,
    installWindowApiStub,
    registerWebMcpTools,
    resetAgentApiAnnouncements,
    SYSTEM_OF_RECORD_INSTRUCTIONS,
    SYSTEM_OF_RECORD_SUMMARY,
} from './browserAgentApi'
import { ensureWebMcpOriginTrialToken } from './webMcpOriginTrial'

const jsonResponse = (body, { status = 200 } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
})

const toolText = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })

const SERVER_TOOLS = [
    { name: 'get_tasks', description: 'List tasks', inputSchema: { type: 'object', properties: {} } },
    { name: 'create_task', description: 'Create a task', inputSchema: { type: 'object', properties: {} } },
    { name: 'delete_authentication_data', description: 'Revoke OAuth', inputSchema: { type: 'object' } },
    { name: 'search_gmail', description: 'Search Gmail', inputSchema: { type: 'object' } },
]

const buildFetch = handler =>
    jest.fn(async (url, init) => {
        const body = JSON.parse(init.body)
        return handler(body, init, url)
    })

const serverFetch = () =>
    buildFetch(body => {
        if (body.method === 'tools/list')
            return jsonResponse({ jsonrpc: '2.0', id: body.id, result: { tools: SERVER_TOOLS } })
        if (body.method === 'tools/call' && body.params.name === 'get_tasks') {
            return jsonResponse({ jsonrpc: '2.0', id: body.id, result: toolText({ tasks: [{ id: 't1' }] }) })
        }
        return jsonResponse({
            jsonrpc: '2.0',
            id: body.id,
            result: { ...toolText({ error: 'Target project not found or not accessible: "x"' }), isError: true },
        })
    })

describe('the MCP session client', () => {
    test('calls the MCP server as the signed-in page and says it is the browser bridge', async () => {
        const fetchImpl = serverFetch()
        const client = createMcpSessionClient({
            endpoint: 'https://my.alldone.app/mcpServer',
            getIdToken: async () => 'id-token-1',
            fetchImpl,
        })

        await client.listTools()

        const [url, init] = fetchImpl.mock.calls[0]
        expect(url).toBe('https://my.alldone.app/mcpServer')
        expect(init.method).toBe('POST')
        expect(init.credentials).toBe('omit')
        expect(init.headers.Authorization).toBe('Bearer id-token-1')
        expect(init.headers[BROWSER_AGENT_CLIENT_HEADER]).toBe(BROWSER_AGENT_CLIENT_NAME)
        expect(JSON.parse(init.body)).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' })
    })

    test('lists the server tools with WebMCP annotations, without the OAuth-only one', async () => {
        const client = createMcpSessionClient({
            endpoint: '/mcpServer',
            getIdToken: async () => 't',
            fetchImpl: serverFetch(),
        })
        const tools = await client.listTools()

        expect(tools.map(tool => tool.name)).toEqual(['get_tasks', 'create_task', 'search_gmail'])
        expect(tools[0].annotations).toEqual({
            readOnlyHint: true,
            consequentialHint: false,
            untrustedContentHint: false,
        })
        expect(tools[1].annotations.readOnlyHint).toBe(false)
        expect(tools[2].annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: true })
    })

    test('returns a parsed result and throws the server error for a refused call', async () => {
        const client = createMcpSessionClient({
            endpoint: '/mcpServer',
            getIdToken: async () => 't',
            fetchImpl: serverFetch(),
        })

        await expect(client.callTool('get_tasks', { projectId: 'p1' })).resolves.toEqual({ tasks: [{ id: 't1' }] })
        await expect(client.callTool('get_tasks_other', { projectId: 'x' })).rejects.toMatchObject({
            name: 'AlldoneToolError',
            message: 'Target project not found or not accessible: "x"',
            tool: 'get_tasks_other',
        })
    })

    test('never sends a request without a signed-in user', async () => {
        const fetchImpl = serverFetch()
        const client = createMcpSessionClient({ endpoint: '/mcpServer', getIdToken: async () => null, fetchImpl })

        await expect(client.callTool('get_tasks', {})).rejects.toThrow(/Not signed in/)
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('does not forward the OAuth revocation tool even when called by name', async () => {
        const fetchImpl = serverFetch()
        const client = createMcpSessionClient({ endpoint: '/mcpServer', getIdToken: async () => 't', fetchImpl })

        await expect(client.callTool('delete_authentication_data', {})).rejects.toBeInstanceOf(AlldoneToolError)
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('surfaces an HTTP auth failure and a JSON-RPC error as readable errors', async () => {
        const unauthorized = createMcpSessionClient({
            endpoint: '/mcpServer',
            getIdToken: async () => 'expired',
            fetchImpl: jest.fn(async () =>
                jsonResponse({ error: 'unauthorized', error_description: 'Authentication required' }, { status: 401 })
            ),
        })
        await expect(unauthorized.listTools()).rejects.toThrow('Authentication required')

        const rateLimited = createMcpSessionClient({
            endpoint: '/mcpServer',
            getIdToken: async () => 't',
            fetchImpl: jest.fn(async () =>
                jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Rate limit exceeded' } })
            ),
        })
        await expect(rateLimited.callTool('get_tasks', {})).rejects.toThrow('Rate limit exceeded')
    })

    test('ignores non-object arguments instead of sending them', async () => {
        const fetchImpl = serverFetch()
        const client = createMcpSessionClient({ endpoint: '/mcpServer', getIdToken: async () => 't', fetchImpl })
        await client.callTool('get_tasks', ['not', 'an', 'object'])
        expect(JSON.parse(fetchImpl.mock.calls[0][1].body).params).toEqual({ name: 'get_tasks', arguments: {} })
    })
})

describe('tool annotations', () => {
    test.each([
        ['get_notes', true, false],
        ['read_knowledge_page', true, false],
        ['search_knowledge', true, false],
        ['save_knowledge_contribution', false, true],
        ['search', true, false],
        ['find_calendar_availability', true, false],
        ['update_task', false, false],
        ['create_calendar_event', false, true],
        ['delete_calendar_event', false, true],
        ['undo_knowledge_correction', false, true],
        ['browser_click', false, true],
    ])('%s: readOnly=%s consequential=%s', (name, readOnly, consequential) => {
        expect(getToolAnnotations(name)).toMatchObject({ readOnlyHint: readOnly, consequentialHint: consequential })
    })
})

describe('endpoint', () => {
    test('uses the hosting rewrite in production and the Functions proxy locally', () => {
        expect(getMcpServerEndpoint({ origin: 'https://my.alldone.app' })).toBe('https://my.alldone.app/mcpServer')
        expect(
            getMcpServerEndpoint({ origin: 'https://localhost:19006', useEmulators: true, projectId: 'alldonestaging' })
        ).toBe('https://localhost:19006/emulator/functions/alldonestaging/europe-west1/mcpServer')
    })
})

describe('native WebMCP registration', () => {
    const tools = [
        {
            name: 'get_tasks',
            description: 'List tasks',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
        },
        { name: 'create_task', description: 'Create', inputSchema: { type: 'object' }, annotations: {} },
    ]

    test('prefers document.modelContext and falls back to the deprecated navigator alias', () => {
        const current = { registerTool: jest.fn() }
        const legacy = { registerTool: jest.fn() }
        expect(getModelContext({ document: { modelContext: current }, navigator: { modelContext: legacy } })).toBe(
            current
        )
        expect(getModelContext({ document: {}, navigator: { modelContext: legacy } })).toBe(legacy)
        expect(getModelContext({ document: {}, navigator: {} })).toBeNull()
    })

    test('registers every tool with an abort signal, and execute returns the result as a string', async () => {
        const registered = []
        const modelContext = {
            registerTool: jest.fn((definition, options) => {
                registered.push({ definition, options })
                return Promise.resolve()
            }),
        }
        const callTool = jest.fn(async (name, input) => ({ name, input }))

        const dispose = registerWebMcpTools(modelContext, tools, callTool)

        expect(registered.map(entry => entry.definition.name)).toEqual(['get_tasks', 'create_task'])
        expect(registered[0].definition).toMatchObject({
            title: 'get tasks',
            description: 'List tasks',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
        })
        const output = await registered[0].definition.execute({ projectId: 'p1' }, { signal: {} })
        expect(JSON.parse(output)).toEqual({ name: 'get_tasks', input: { projectId: 'p1' } })

        expect(registered[0].options.signal.aborted).toBe(false)
        dispose()
        expect(registered[0].options.signal.aborted).toBe(true)
    })

    test('a refused tool does not stop the others, and pre-signal builds unregister by name', () => {
        const modelContext = {
            registerTool: jest.fn(definition => {
                if (definition.name === 'get_tasks') throw new Error('duplicate')
            }),
            unregisterTool: jest.fn(),
        }
        const onError = jest.fn()
        const dispose = registerWebMcpTools(modelContext, tools, jest.fn(), { onError })

        expect(modelContext.registerTool).toHaveBeenCalledTimes(2)
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'get_tasks')
        dispose()
        expect(modelContext.unregisterTool).toHaveBeenCalledWith('create_task')
        expect(modelContext.unregisterTool).not.toHaveBeenCalledWith('get_tasks')
    })

    test('an execute failure reaches the agent as an error', async () => {
        let execute
        const modelContext = { registerTool: jest.fn(definition => (execute = definition.execute)) }
        registerWebMcpTools(modelContext, [tools[0]], async () => {
            throw new AlldoneToolError('The "get_tasks" tool is disabled for this account.')
        })
        await expect(execute({})).rejects.toThrow(/disabled/)
    })
})

describe('window.alldone', () => {
    afterEach(() => {
        delete window.alldone
    })

    test('installs a frozen API whose calls go to the session client', async () => {
        const listTools = jest.fn(async () => [{ name: 'get_tasks' }])
        const callTool = jest.fn(async () => ({ ok: true }))
        const ready = jest.fn()
        window.addEventListener(BROWSER_AGENT_READY_EVENT, ready)

        const uninstall = installWindowApi(window, {
            listTools,
            callTool,
            getStatus: () => ({ webMcpSupported: false }),
        })

        expect(Object.isFrozen(window.alldone)).toBe(true)
        expect(window.alldone.version).toBe(1)
        expect(ready).toHaveBeenCalled()
        expect(document.documentElement.getAttribute('data-alldone-agent-api')).toBe('window.alldone')
        expect(window.alldone.help()).toMatch(/alldone\.callTool/)
        expect(window.alldone.help()).toMatch(/not available in this browser/)

        await window.alldone.listTools()
        await window.alldone.listTools()
        expect(listTools).toHaveBeenCalledTimes(1)
        await window.alldone.refresh()
        expect(listTools).toHaveBeenCalledTimes(2)

        await expect(window.alldone.tools.create_task({ name: 'Milk' })).resolves.toEqual({ ok: true })
        expect(callTool).toHaveBeenCalledWith('create_task', { name: 'Milk' })
        // Not a thenable: `await alldone.tools` must not hang or call a tool named "then".
        expect(window.alldone.tools.then).toBeUndefined()

        uninstall()
        expect(window.alldone).toBeUndefined()
        expect(document.documentElement.hasAttribute('data-alldone-agent-api')).toBe(false)
        window.removeEventListener(BROWSER_AGENT_READY_EVENT, ready)
    })

    test('a failed tool listing is not cached', async () => {
        const listTools = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([])
        const uninstall = installWindowApi(window, { listTools, callTool: jest.fn() })
        await expect(window.alldone.listTools()).rejects.toThrow('offline')
        await expect(window.alldone.listTools()).resolves.toEqual([])
        uninstall()
    })

    test('an older session never removes the API of the session that replaced it', () => {
        const first = installWindowApi(window, { listTools: jest.fn(), callTool: jest.fn() })
        const second = installWindowApi(window, { listTools: jest.fn(), callTool: jest.fn() })
        const current = window.alldone
        first()
        expect(window.alldone).toBe(current)
        second()
        expect(window.alldone).toBeUndefined()
    })
})

describe('installBrowserAgentApi', () => {
    beforeEach(() => {
        jest.spyOn(console, 'info').mockImplementation(() => {})
    })

    afterEach(() => {
        console.info.mockRestore()
        delete window.alldone
        delete document.modelContext
    })

    test('installs both surfaces, and dispose removes both', async () => {
        const modelContext = { registerTool: jest.fn() }
        document.modelContext = modelContext
        const client = { listTools: jest.fn(async () => [{ name: 'get_tasks', annotations: {} }]), callTool: jest.fn() }

        const dispose = await installBrowserAgentApi({ win: window, client })

        expect(window.alldone).toBeDefined()
        expect(modelContext.registerTool).toHaveBeenCalledTimes(1)
        expect(window.alldone.status()).toEqual({ state: 'ready', webMcpSupported: true, webMcpRegistered: 1 })
        const signal = modelContext.registerTool.mock.calls[0][1].signal
        dispose()
        expect(signal.aborted).toBe(true)
        expect(window.alldone).toBeUndefined()
    })

    test('a session replaced before its tool list arrived registers nothing', async () => {
        const modelContext = { registerTool: jest.fn() }
        document.modelContext = modelContext
        let resolveTools
        const client = {
            listTools: jest.fn(() => new Promise(resolve => (resolveTools = resolve))),
            callTool: jest.fn(),
        }
        const controller = new AbortController()

        const pending = installBrowserAgentApi({ win: window, client, signal: controller.signal })
        controller.abort()
        resolveTools([{ name: 'get_tasks', annotations: {} }])
        const dispose = await pending

        expect(modelContext.registerTool).not.toHaveBeenCalled()
        dispose()
    })

    test('without WebMCP only window.alldone is installed and nothing is fetched up front', async () => {
        const client = { listTools: jest.fn(), callTool: jest.fn() }
        const dispose = await installBrowserAgentApi({ win: window, client })
        expect(window.alldone.status()).toEqual({ state: 'ready', webMcpSupported: false, webMcpRegistered: 0 })
        expect(client.listTools).not.toHaveBeenCalled()
        dispose()
    })
})

describe('discoverability (AT-2890)', () => {
    const readManifest = () => JSON.parse(document.getElementById(AGENT_API_MANIFEST_ID).textContent)
    let info

    beforeEach(() => {
        resetAgentApiAnnouncements()
        info = jest.spyOn(console, 'info').mockImplementation(() => {})
    })

    afterEach(() => {
        info.mockRestore()
        delete window.alldone
        delete document.modelContext
    })

    test('window.alldone is enumerable, so Object.keys(window) finds it', () => {
        const uninstall = installWindowApi(window, { listTools: jest.fn(), callTool: jest.fn() })
        expect(Object.keys(window)).toContain('alldone')
        expect(Object.getOwnPropertyDescriptor(window, 'alldone')).toMatchObject({
            enumerable: true,
            writable: false,
            configurable: true,
        })
        expect(Object.keys(window.alldone)).toEqual(
            expect.arrayContaining(['listTools', 'callTool', 'tools', 'help', 'status', 'whenReady', 'state'])
        )
        expect(Object.prototype.toString.call(window.alldone)).toBe('[object Alldone]')
        uninstall()
        expect(Object.keys(window)).not.toContain('alldone')
    })

    test('help(), the stubs and the manifest tell the agent that Alldone is the system of record (AT-2832)', async () => {
        const uninstallStub = installWindowApiStub(window, { state: AGENT_API_STATES.SIGNED_OUT })
        expect(window.alldone.help()).toContain(SYSTEM_OF_RECORD_SUMMARY)
        expect(readManifest().systemOfRecord).toBe(SYSTEM_OF_RECORD_SUMMARY)
        uninstallStub()

        const uninstall = installWindowApi(window, { listTools: async () => [], callTool: jest.fn() })
        const help = window.alldone.help()
        for (const line of SYSTEM_OF_RECORD_INSTRUCTIONS) expect(help).toContain(line)
        expect(help).toMatch(/system of record/)
        expect(help).toMatch(/update_task with comment/)
        // The manifest never names tools, so its summary must not either.
        expect(SYSTEM_OF_RECORD_SUMMARY).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
        uninstall()
    })

    test('alldone.tools lists the tool names once they are loaded, and help() names them', async () => {
        const callTool = jest.fn(async () => 'ok')
        const uninstall = installWindowApi(window, {
            listTools: async () => [{ name: 'get_tasks' }, { name: 'read_knowledge_page' }],
            callTool,
        })
        expect(Object.keys(window.alldone.tools)).toEqual([])

        await window.alldone.listTools()

        expect(Object.keys(window.alldone.tools)).toEqual(['get_tasks', 'read_knowledge_page'])
        expect('get_tasks' in window.alldone.tools).toBe(true)
        expect(window.alldone.tools.get_tasks.name).toBe('get_tasks')
        expect(window.alldone.tools.get_tasks).toBe(window.alldone.tools.get_tasks)
        expect(window.alldone.help()).toMatch(/2 tools: get_tasks, read_knowledge_page/)
        // Enumerating or serialising the shortcut never calls a tool.
        expect(JSON.stringify(window.alldone.tools)).toBe('{}')
        expect(window.alldone.tools.toJSON).toBeUndefined()
        expect(window.alldone.tools.constructor).toBeUndefined()
        expect(callTool).not.toHaveBeenCalled()
        uninstall()
    })

    test('a signed-in session publishes a manifest and DOM markers without any tool or user data', async () => {
        const modelContext = { registerTool: jest.fn() }
        document.modelContext = modelContext
        const client = {
            listTools: jest.fn(async () => [{ name: 'get_tasks', description: 'secret-ish', annotations: {} }]),
            callTool: jest.fn(),
        }
        const dispose = await installBrowserAgentApi({ win: window, client })

        const root = document.documentElement
        expect(root.getAttribute('data-alldone-agent-api')).toBe('window.alldone')
        expect(root.getAttribute('data-alldone-agent-api-state')).toBe('ready')
        const element = document.getElementById(AGENT_API_MANIFEST_ID)
        expect(element.getAttribute('type')).toBe('application/json')
        const manifest = readManifest()
        expect(manifest).toMatchObject({
            state: 'ready',
            javascript: 'window.alldone',
            docs: '/llms.txt',
            webMcp: { available: true, registeredTools: 1 },
        })
        expect(JSON.stringify(manifest)).not.toMatch(/get_tasks|secret-ish|uid|email/)

        dispose()
        expect(document.getElementById(AGENT_API_MANIFEST_ID)).toBeNull()
        expect(root.hasAttribute('data-alldone-agent-api-state')).toBe(false)
    })

    test('announces the API once per page in the console', async () => {
        const client = { listTools: jest.fn(), callTool: jest.fn() }
        const first = await installBrowserAgentApi({ win: window, client })
        first()
        const second = await installBrowserAgentApi({ win: window, client })
        second()
        expect(info).toHaveBeenCalledTimes(1)
        expect(info.mock.calls[0][0]).toMatch(/window\.alldone.*alldone\.help\(\).*\/llms\.txt/)
        expect(client.listTools).not.toHaveBeenCalled()
    })

    test('a signed-out stub explains itself, has no tools and makes no request', async () => {
        const uninstall = installWindowApiStub(window, { state: AGENT_API_STATES.SIGNED_OUT })

        expect(Object.keys(window)).toContain('alldone')
        expect(window.alldone.state).toBe('signed_out')
        expect(window.alldone.help()).toMatch(/Nobody is signed in/)
        await expect(window.alldone.listTools()).rejects.toThrow(/Not signed in/)
        await expect(window.alldone.callTool('get_tasks', {})).rejects.toBeInstanceOf(AlldoneToolError)
        await expect(window.alldone.tools.get_tasks({})).rejects.toThrow(/Not signed in/)
        expect(Object.keys(window.alldone.tools)).toEqual([])
        expect(readManifest()).toMatchObject({
            state: 'signed_out',
            usage: ['await alldone.whenReady()', 'alldone.help()'],
        })
        expect(document.documentElement.getAttribute('data-alldone-agent-api-state')).toBe('signed_out')
        expect(info).toHaveBeenCalledWith(expect.stringMatching(/signed_out/))
        uninstall()
        expect(window.alldone).toBeUndefined()
    })

    test('the loading stub stays quiet in the console', () => {
        const uninstall = installWindowApiStub(window, { state: AGENT_API_STATES.LOADING })
        expect(window.alldone.help()).toMatch(/still loading/)
        expect(info).not.toHaveBeenCalled()
        uninstall()
    })

    test('whenReady() on the stub resolves with the real API once a session installs it', async () => {
        const uninstallStub = installWindowApiStub(window, { state: AGENT_API_STATES.LOADING })
        const pending = window.alldone.whenReady()

        uninstallStub()
        const uninstall = installWindowApi(window, { listTools: jest.fn(), callTool: jest.fn() })

        const api = await pending
        expect(api).toBe(window.alldone)
        expect(api.state).toBe('ready')
        await expect(api.whenReady()).resolves.toBe(api)
        uninstall()
    })

    test('whenReady() on the stub gives up after its timeout', async () => {
        jest.useFakeTimers()
        try {
            const uninstall = installWindowApiStub(window, { state: AGENT_API_STATES.SIGNED_OUT })
            const pending = window.alldone.whenReady(1000)
            jest.advanceTimersByTime(1000)
            await expect(pending).rejects.toThrow(/did not become ready/)
            uninstall()
        } finally {
            jest.useRealTimers()
        }
    })
})

describe('WebMCP origin trial token', () => {
    afterEach(() => {
        document.head.querySelectorAll('meta[http-equiv="origin-trial"]').forEach(meta => meta.remove())
    })

    test('injects the token for this host once, and nothing for an unknown host', () => {
        const tokens = { 'my.alldone.app': 'TOKEN' }
        expect(ensureWebMcpOriginTrialToken(document, 'example.com', tokens)).toBe(false)
        expect(ensureWebMcpOriginTrialToken(document, 'my.alldone.app', tokens)).toBe(true)
        expect(ensureWebMcpOriginTrialToken(document, 'my.alldone.app', tokens)).toBe(true)
        const metas = document.head.querySelectorAll('meta[http-equiv="origin-trial"]')
        expect(metas).toHaveLength(1)
        expect(metas[0].getAttribute('content')).toBe('TOKEN')
    })
})
