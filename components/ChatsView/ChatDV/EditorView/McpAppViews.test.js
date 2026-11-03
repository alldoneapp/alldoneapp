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

    test('a second view of the same app under one answer replaces the first: one card, the newest opens', () => {
        // 2026-11-03: judy_show ran twice in one run (dermatology, then all specialties).
        const judy = (viewId, ageMs) => ({ ...view(viewId, ageMs), serverId: 'alldone_team', resourceUri: 'ui://judy' })
        mockViews = [judy('first', 50 * 1000), judy('second', 1000)]
        const pane = { open: jest.fn(), selectedViewId: 'second' }
        act(() =>
            root.render(
                <AnnaAppPaneContext.Provider value={pane}>
                    <McpAppViews commentId="comment-1" />
                </AnnaAppPaneContext.Provider>
            )
        )
        expect(pane.open).toHaveBeenCalledTimes(1)
        expect(pane.open).toHaveBeenCalledWith(expect.objectContaining({ viewId: 'second' }), { auto: true })
        expect(container.textContent.match(/Judy Job/g)).toHaveLength(1)
        expect(container.textContent).toContain('mcp_app_open_on_right')
    })

    test('views of different apps under one answer each keep their card', () => {
        mockViews = [
            { ...view('judy', 1000), serverId: 'alldone_team', resourceUri: 'ui://judy' },
            { ...view('story', 1000), appName: 'Story Builder', serverId: 'alldone_team', resourceUri: 'ui://story' },
        ]
        const pane = { open: jest.fn(), selectedViewId: null }
        act(() =>
            root.render(
                <AnnaAppPaneContext.Provider value={pane}>
                    <McpAppViews commentId="comment-1" />
                </AnnaAppPaneContext.Provider>
            )
        )
        expect(container.textContent).toContain('Judy Job')
        expect(container.textContent).toContain('Story Builder')
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

describe('the frame a view runs in', () => {
    let container
    let root
    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete global.IS_REACT_ACT_ENVIRONMENT
        mockLoadResource.mockImplementation(() => new Promise(() => {}))
    })

    // Judy's collapse button ("Show in chat") asks the host for the inline display mode.
    test.each([
        ['inline', 1],
        ['fullscreen', 0],
    ])('a request for %s mode closes it %i time(s) and leaves the view in fullscreen', async (mode, closes) => {
        const { McpAppFrame } = require('./McpAppViews')
        mockLoadResource.mockImplementation(async () => ({ html: '<p>Judy</p>', csp: null, toolName: 'judy_show' }))
        const onClose = jest.fn()
        await act(async () => root.render(<McpAppFrame view={view('v1', 0)} language="de" onClose={onClose} />))
        const frameWindow = container.querySelector('iframe').contentWindow
        const answers = []
        frameWindow.postMessage = message => answers.push(message)
        await act(async () =>
            window.dispatchEvent(
                new MessageEvent('message', {
                    source: frameWindow,
                    data: { jsonrpc: '2.0', id: 7, method: 'ui/request-display-mode', params: { mode } },
                })
            )
        )
        expect(onClose).toHaveBeenCalledTimes(closes)
        expect(answers).toEqual([{ jsonrpc: '2.0', id: 7, result: { mode: 'fullscreen' } }])
    })
})
