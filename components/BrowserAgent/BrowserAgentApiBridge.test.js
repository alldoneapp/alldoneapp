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

import BrowserAgentApiBridge from './BrowserAgentApiBridge'

const signedIn = (overrides = {}) => ({
    loggedUser: { uid: 'user-1', isAnonymous: false, mcpEnabled: true, mcpDisabledTools: [], ...overrides },
})

describe('BrowserAgentApiBridge (AT-2871)', () => {
    let renderer

    beforeEach(() => {
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
        ['anonymous visitor', signedIn({ isAnonymous: true })],
        ['nobody signed in', { loggedUser: {} }],
    ])('installs nothing for: %s', async (_, state) => {
        await render(state)
        expect(window.alldone).toBeUndefined()
    })

    test('never sends the token of another account than the one the page shows', async () => {
        mockCurrentUser = { uid: 'someone-else', isAnonymous: false, getIdToken: jest.fn(async () => 'other') }
        await render(signedIn())

        await expect(window.alldone.callTool('get_tasks', {})).rejects.toThrow(/Not signed in/)
        expect(mockCurrentUser.getIdToken).not.toHaveBeenCalled()
        expect(global.fetch).not.toHaveBeenCalled()
    })
})
