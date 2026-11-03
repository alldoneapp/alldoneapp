/**
 * @jest-environment jsdom
 *
 * AT-2951: both embed windows (IframeModal for pre-configured iframe tasks, McpAppModal for MCP Apps
 * views) carry the "expand to the left" assistant-mode button in their header, which moves the app
 * into the assistant shell's right pane; and an app opened while assistant mode is on never shows a
 * window at all — it goes straight to the pane. Drives the REAL bridge with a stand-in for the
 * shell's opener (AnnaShell's side is pinned in AnnaShell.test.js).
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

let mockState
const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../../redux/actions', () => ({
    setIframeModalData: (visible, url, name) => ({ type: 'setIframeModalData', visible, url, name }),
}))
jest.mock('../../../../hooks/useEscapeKey', () => () => {})
jest.mock('../../../../hooks/useSafeAreaOverlayPadding', () => () => ({}))
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('./EmbeddedAppFrame', () => props => <div data-testid="embedded-frame" data-url={props.url} />)
jest.mock('../../../ChatsView/ChatDV/EditorView/McpAppViews', () => ({
    McpAppFrame: props => <div data-testid="mcp-frame" data-view={props.view.viewId} />,
}))

const IframeModal = require('./IframeModal').default
const McpAppModal = require('../../../ChatsView/ChatDV/EditorView/McpAppModal').default
const { registerAnnaAppPane, iframeAppView, openInEmbedWindow } = require('../../../Anna/annaAppPaneBridge')
const {
    openMcpAppView,
    getOpenMcpAppView,
    closeMcpAppView,
} = require('../../../ChatsView/ChatDV/EditorView/mcpAppModalStore')

const URL = 'https://alldone.team/story-builder?embed=true'
const BUTTON = '[data-testid="embed-open-in-assistant-mode"]'
const judy = { viewId: 'v1', appName: 'Judy Job', serverId: 'team', resourceUri: 'ui://judy/app.html' }

describe('embed windows and the assistant pane (AT-2951)', () => {
    let container
    let root
    let paneOpener
    let unregister

    const render = element => act(() => root.render(element))
    const iframeOpen = () => ({ visible: true, url: URL, name: 'Story Builder' })

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        mockState = {
            iframeModalData: iframeOpen(),
            loggedUser: { uid: 'u1', language: 'de', isAnonymous: false },
            defaultAssistant: { uid: 'anna' },
        }
        mockDispatch.mockClear()
        paneOpener = jest.fn()
        unregister = null
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        act(() => unregister?.())
        act(() => closeMcpAppView())
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    const mountShell = active =>
        act(() => {
            unregister = registerAnnaAppPane(paneOpener, active)
        })

    describe('IframeModal', () => {
        it('opens as a window without the button when there is no assistant shell', () => {
            render(<IframeModal />)
            expect(container.querySelector('[data-testid="embedded-frame"]')).toBeTruthy()
            expect(container.querySelector(BUTTON)).toBeNull()
        })

        it('hides the button for an account without an assistant', () => {
            mockState.defaultAssistant = null
            mountShell(false)
            render(<IframeModal />)
            expect(container.querySelector(BUTTON)).toBeNull()
        })

        it('moves the app to the right pane from the header button and closes the window', () => {
            mountShell(false)
            render(<IframeModal />)
            const button = container.querySelector(BUTTON)
            expect(button).toBeTruthy()

            act(() => button.click())

            expect(paneOpener).toHaveBeenCalledWith(iframeAppView(URL, 'Story Builder'), undefined)
            expect(paneOpener.mock.calls[0][0]).toEqual({
                kind: 'iframe',
                viewId: `iframe:${URL}`,
                url: URL,
                appName: 'Story Builder',
            })
            expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ visible: false }))
        })

        it('opens straight in the pane, without a window, while assistant mode is on', () => {
            mountShell(true)
            render(<IframeModal />)

            expect(container.querySelector('[data-testid="embedded-frame"]')).toBeNull()
            expect(paneOpener).toHaveBeenCalledTimes(1)
            expect(paneOpener.mock.calls[0][0].url).toBe(URL)
            expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ visible: false }))
        })

        it('does nothing while closed', () => {
            mockState.iframeModalData = { visible: false, url: '', name: '' }
            mountShell(true)
            render(<IframeModal />)
            expect(paneOpener).not.toHaveBeenCalled()
            expect(container.innerHTML).toBe('')
        })
    })

    describe('McpAppModal', () => {
        it('moves the view to the right pane from the header button', () => {
            mountShell(false)
            act(() => openMcpAppView(judy))
            render(<McpAppModal />)
            expect(container.querySelector('[data-testid="mcp-frame"]')).toBeTruthy()

            act(() => container.querySelector(BUTTON).click())

            expect(paneOpener).toHaveBeenCalledWith(judy, undefined)
            expect(getOpenMcpAppView()).toBeNull()
            expect(container.querySelector('[data-testid="mcp-frame"]')).toBeNull()
        })

        it('hands a view opened while assistant mode is on to the pane', () => {
            mountShell(true)
            render(<McpAppModal />)
            act(() => openMcpAppView(judy))

            expect(paneOpener).toHaveBeenCalledWith(judy, undefined)
            expect(getOpenMcpAppView()).toBeNull()
            expect(container.querySelector('[data-testid="mcp-frame"]')).toBeNull()
        })

        it('keeps the window and offers no button without an assistant shell', () => {
            act(() => openMcpAppView(judy))
            render(<McpAppModal />)
            expect(container.querySelector('[data-testid="mcp-frame"]')).toBeTruthy()
            expect(container.querySelector(BUTTON)).toBeNull()
        })
    })

    // The way back: AnnaShell hands the app that was in its pane to these windows when assistant mode
    // is left (the shell's side is pinned in AnnaShell.test.js). It does so after reporting assistant
    // mode as off, which is what keeps the window from sending the app straight back to the pane.
    describe('leaving assistant mode', () => {
        const leaveAssistantMode = () =>
            act(() => {
                unregister()
                unregister = registerAnnaAppPane(paneOpener, false)
            })

        it('reopens a tool page in IframeModal with its URL and name', () => {
            mockState.iframeModalData = { visible: false, url: '', name: '' }
            mountShell(true)
            render(<IframeModal />)
            leaveAssistantMode()

            let opened
            act(() => {
                opened = openInEmbedWindow(iframeAppView(URL, 'Story Builder'))
            })

            expect(opened).toBe(true)
            expect(mockDispatch).toHaveBeenCalledWith({
                type: 'setIframeModalData',
                visible: true,
                url: URL,
                name: 'Story Builder',
            })
            mockState.iframeModalData = iframeOpen()
            render(<IframeModal />)
            expect(container.querySelector('[data-testid="embedded-frame"]').getAttribute('data-url')).toBe(URL)
            expect(paneOpener).not.toHaveBeenCalled()
        })

        it('reopens an MCP app in McpAppModal', () => {
            mountShell(true)
            render(<McpAppModal />)
            leaveAssistantMode()

            act(() => {
                openInEmbedWindow(judy)
            })

            expect(getOpenMcpAppView()).toBe(judy)
            expect(container.querySelector('[data-testid="mcp-frame"]').getAttribute('data-view')).toBe('v1')
            expect(paneOpener).not.toHaveBeenCalled()
        })

        it('has nowhere to go while no window is mounted', () => {
            expect(openInEmbedWindow(iframeAppView(URL, 'Story Builder'))).toBe(false)
            expect(openInEmbedWindow(judy)).toBe(false)
        })
    })
})
