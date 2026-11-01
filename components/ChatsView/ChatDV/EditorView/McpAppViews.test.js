/**
 * @jest-environment jsdom
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

let mockViews = []
const mockLoadResource = jest.fn(() => new Promise(() => {}))
jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'me', language: 'de' } }),
}))
jest.mock('../../../../utils/backends/Assistants/mcpAppViews', () => ({
    watchMcpAppViews: (_commentId, _userId, callback) => {
        callback(mockViews)
        return () => {}
    },
    loadMcpAppResource: (...args) => mockLoadResource(...args),
    callMcpAppTool: jest.fn(),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))

const McpAppViews = require('./McpAppViews').default
const AnnaAppPaneContext = require('../../../Anna/AnnaAppPaneContext').default

const view = (viewId, ageMs) => ({
    viewId,
    appName: 'Judy Job',
    serverLabel: 'alldone.team',
    toolName: 'judy_show',
    createdAt: Date.now() - ageMs,
})

describe('MCP Apps views under an answer', () => {
    let container
    let root
    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        mockLoadResource.mockClear()
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    test('in Anna’s chat, a view that arrives with the answer opens on the right and the chat keeps a card', () => {
        mockViews = [view('fresh', 1000), view('old', 60 * 60 * 1000)]
        const pane = { open: jest.fn(), selectedViewId: 'fresh' }
        act(() =>
            root.render(
                <AnnaAppPaneContext.Provider value={pane}>
                    <McpAppViews commentId="comment-1" />
                </AnnaAppPaneContext.Provider>
            )
        )
        expect(pane.open).toHaveBeenCalledTimes(1)
        expect(pane.open).toHaveBeenCalledWith(expect.objectContaining({ viewId: 'fresh' }), { auto: true })
        expect(container.textContent).toContain('Judy Job')
        expect(container.textContent).toContain('mcp_app_open_on_right')
        expect(container.textContent).toContain('mcp_app_show')
        expect(container.querySelector('iframe')).toBeNull()
        expect(mockLoadResource).not.toHaveBeenCalled()
    })

    test('the card of an older view opens it on a tap', () => {
        mockViews = [view('old', 60 * 60 * 1000)]
        const pane = { open: jest.fn(), selectedViewId: null }
        act(() =>
            root.render(
                <AnnaAppPaneContext.Provider value={pane}>
                    <McpAppViews commentId="comment-1" />
                </AnnaAppPaneContext.Provider>
            )
        )
        expect(pane.open).not.toHaveBeenCalled()
        const show = [...container.querySelectorAll('[role="button"]')].find(node =>
            node.textContent.includes('mcp_app_show')
        )
        act(() => show.click())
        expect(pane.open).toHaveBeenCalledWith(expect.objectContaining({ viewId: 'old' }))
    })

    test('outside the assistant shell a new view opens in the embed window, never inline', () => {
        const store = require('./mcpAppModalStore')
        store.closeMcpAppView()
        mockViews = [view('fresh', 1000)]
        act(() => root.render(<McpAppViews commentId="comment-1" />))
        expect(store.getOpenMcpAppView()).toMatchObject({ viewId: 'fresh' })
        expect(container.querySelector('iframe')).toBeNull()
        expect(container.textContent).toContain('mcp_app_open')
        act(() => store.closeMcpAppView())
        expect(container.textContent).toContain('mcp_app_show')
    })
})
