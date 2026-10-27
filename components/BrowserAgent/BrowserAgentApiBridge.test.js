import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

let mockState
let mockCurrentUser

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))

jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {
        apps: [{}],
        app: () => ({ options: { projectId: 'alldonealeph' } }),
        auth: () => ({ currentUser: mockCurrentUser }),
    },
}))

jest.mock('../../utils/firebaseEmulators', () => ({ shouldUseFirebaseEmulators: () => false }))

import BrowserAgentApiBridge, { resolveBrowserAgentPageState } from './BrowserAgentApiBridge'

const signedIn = (overrides = {}) => ({
    loggedIn: true,
    loggedUser: { uid: 'user-1', isAnonymous: false, mcpEnabled: true, mcpDisabledTools: [], ...overrides },
})

describe('BrowserAgentApiBridge (AT-2871)', () => {
    let renderer

    beforeEach(() => {
        jest.spyOn(console, 'info').mockImplementation(() => {})
        mockCurrentUser = { uid: 'user-1', isAnonymous: false, getIdToken: jest.fn(async () => 'id-token') }
        global.fetch = jest.fn(async (url, init) => ({
            ok: true,
            status: 200,
            json: async () => ({
                jsonrpc: '2.0',
                id: JSON.parse(init.body).id,
                result: { content: [{ type: 'text', text: '{"tasks":[]}' }] },
            }),
        }))
    })

    afterEach(() => {
        if (renderer) act(() => renderer.unmount())
        renderer = null
        delete window.alldone
        delete global.fetch
        console.info.mockRestore()
    })

    const render = async state => {
        mockState = state
        await act(async () => {
            renderer = TestRenderer.create(<BrowserAgentApiBridge />)
        })
    }

    test('a signed-in user gets window.alldone, which calls the MCP server with the session token', async () => {
        await render(signedIn())

        expect(window.alldone).toBeDefined()
        await expect(window.alldone.callTool('get_tasks', {})).resolves.toEqual({ tasks: [] })
        const [url, init] = global.fetch.mock.calls[0]
        expect(url).toBe(`${window.location.origin}/mcpServer`)
        expect(init.headers.Authorization).toBe('Bearer id-token')
    })

    test('switching browser agents off removes the API', async () => {
        await render(signedIn())
        expect(window.alldone).toBeDefined()

        mockState = signedIn({ browserAgentToolsEnabled: false })
        await act(async () => renderer.update(<BrowserAgentApiBridge />))
        expect(window.alldone).toBeUndefined()
    })

    test.each([
        ['MCP switched off', signedIn({ mcpEnabled: false })],
        ['browser agents switched off', signedIn({ browserAgentToolsEnabled: false })],
    ])('installs nothing, not even the stub, for: %s', async (_, state) => {
        await render(state)
        expect(window.alldone).toBeUndefined()
    })

    test.each([
        ['anonymous visitor', signedIn({ isAnonymous: true }), 'signed_out'],
        ['nobody signed in', { loggedIn: false, loggedUser: {} }, 'signed_out'],
        ['app still booting', { loggedIn: null, loggedUser: {} }, 'loading'],
    ])('installs a stub without tools for: %s (AT-2890)', async (_, state, expected) => {
        await render(state)
        expect(window.alldone.state).toBe(expected)
        await expect(window.alldone.callTool('get_tasks', {})).rejects.toThrow()
        expect(global.fetch).not.toHaveBeenCalled()
        expect(mockCurrentUser.getIdToken).not.toHaveBeenCalled()
    })

    test('a signed-in session that is not ready yet shows the loading stub, then the tools', async () => {
        mockState = signedIn()
        await act(async () => {
            renderer = TestRenderer.create(<BrowserAgentApiBridge sessionReady={false} />)
        })
        expect(window.alldone.state).toBe('loading')
        const ready = window.alldone.whenReady()

        await act(async () => renderer.update(<BrowserAgentApiBridge sessionReady />))

        const api = await ready
        expect(api.state).toBe('ready')
        await expect(api.callTool('get_tasks', {})).resolves.toEqual({ tasks: [] })
    })

    test('signing out replaces the tools with the signed-out stub', async () => {
        await render(signedIn())
        expect(window.alldone.state).toBe('ready')

        mockState = { loggedIn: false, loggedUser: {} }
        await act(async () => renderer.update(<BrowserAgentApiBridge />))
        expect(window.alldone.state).toBe('signed_out')
    })

    test('resolveBrowserAgentPageState', () => {
        const base = { loggedIn: true, uid: 'u', isAnonymous: false, enabled: true, sessionReady: true }
        expect(resolveBrowserAgentPageState(base)).toBe('ready')
        expect(resolveBrowserAgentPageState({ ...base, sessionReady: false })).toBe('loading')
        expect(resolveBrowserAgentPageState({ ...base, uid: '' })).toBe('loading')
        expect(resolveBrowserAgentPageState({ ...base, enabled: false })).toBeNull()
        expect(resolveBrowserAgentPageState({ ...base, loggedIn: false })).toBe('signed_out')
        expect(resolveBrowserAgentPageState({ ...base, isAnonymous: true })).toBe('signed_out')
        expect(resolveBrowserAgentPageState({ ...base, loggedIn: null })).toBe('loading')
    })

    test('never sends the token of another account than the one the page shows', async () => {
        mockCurrentUser = { uid: 'someone-else', isAnonymous: false, getIdToken: jest.fn(async () => 'other') }
        await render(signedIn())

        await expect(window.alldone.callTool('get_tasks', {})).rejects.toThrow(/Not signed in/)
        expect(mockCurrentUser.getIdToken).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
    })
})
