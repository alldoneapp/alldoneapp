/**
 * @jest-environment jsdom
 *
 * AT-2953: both embed windows (IframeModal for pre-configured iframe apps, McpAppModal for MCP Apps
 * views) fill the viewport but for one uniform 16px gap — full screen on a phone — and close on a
 * click on the backdrop next to them. Drives the REAL components through react-dom and dispatches
 * real pointer/click events at the real backdrop node, because "a click that started inside and
 * ended outside does not close" is not observable from a hand-called handler.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

let mockState
let mockWindowWidth
const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../../redux/actions', () => ({
    setIframeModalData: (visible, url, name) => ({ type: 'setIframeModalData', visible, url, name }),
}))
jest.mock('../../../../hooks/useEscapeKey', () => () => {})
// Echo the minimum gap the window asks for, as the hook does on a device without insets.
jest.mock('../../../../hooks/useSafeAreaOverlayPadding', () => (minimum = {}) => ({
    paddingTop: minimum.top || 0,
    paddingRight: minimum.right || 0,
    paddingBottom: minimum.bottom || 0,
    paddingLeft: minimum.left || 0,
}))
jest.mock('../../../../utils/useWindowSize', () => () => [mockWindowWidth, 800])
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('./EmbeddedAppFrame', () => () => <div data-testid="embedded-frame" />)
jest.mock('../../../ChatsView/ChatDV/EditorView/McpAppViews', () => ({
    McpAppFrame: () => <div data-testid="mcp-frame" />,
}))

const IframeModal = require('./IframeModal').default
const McpAppModal = require('../../../ChatsView/ChatDV/EditorView/McpAppModal').default
const {
    openMcpAppView,
    getOpenMcpAppView,
    closeMcpAppView,
} = require('../../../ChatsView/ChatDV/EditorView/mcpAppModalStore')
const { isEmbedWindowFullscreen, getEmbedWindowGap } = require('./embedWindowLayout')

const BACKDROP = '[data-testid="embed-window-backdrop"]'
const judy = { viewId: 'v1', appName: 'Judy Job', serverId: 'team', resourceUri: 'ui://judy/app.html' }

const fire = (node, type) =>
    act(() => {
        node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    })
const press = (downOn, upOn = downOn) => {
    fire(downOn, 'pointerdown')
    fire(upOn, 'click')
}

describe('embed window layout helpers', () => {
    it('is full screen below the sheet breakpoint and a card above it', () => {
        expect(isEmbedWindowFullscreen(390)).toBe(true)
        expect(isEmbedWindowFullscreen(639)).toBe(true)
        expect(isEmbedWindowFullscreen(640)).toBe(false)
        expect(isEmbedWindowFullscreen(1440)).toBe(false)
        // An unmeasured viewport is not a phone.
        expect(isEmbedWindowFullscreen(0)).toBe(false)
    })

    it('uses the same gap on every edge', () => {
        expect(getEmbedWindowGap(false)).toEqual({ top: 16, right: 16, bottom: 16, left: 16 })
        expect(getEmbedWindowGap(true)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    })
})

describe.each([
    [
        'IframeModal',
        () => <IframeModal />,
        () => mockDispatch.mock.calls.some(([action]) => action.type === 'setIframeModalData' && !action.visible),
        '[data-testid="embedded-frame"]',
    ],
    ['McpAppModal', () => <McpAppModal />, () => getOpenMcpAppView() === null, '[data-testid="mcp-frame"]'],
])('%s (AT-2953)', (_name, element, isClosed, frameSelector) => {
    let container
    let root

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        mockWindowWidth = 1440
        mockState = {
            iframeModalData: { visible: true, url: 'https://alldone.team/tool?embed=true', name: 'Tool' },
            loggedUser: { uid: 'u1', language: 'de', isAnonymous: false },
            defaultAssistant: null,
        }
        mockDispatch.mockClear()
        act(() => openMcpAppView(judy))
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        act(() => closeMcpAppView())
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    const render = () => act(() => root.render(element()))
    const backdrop = () => container.querySelector(BACKDROP)
    const card = () => backdrop().firstElementChild

    it('fills the viewport but for a uniform 16px gap, with no percentage or max size', () => {
        render()
        const overlay = backdrop().style
        expect([overlay.paddingTop, overlay.paddingRight, overlay.paddingBottom, overlay.paddingLeft]).toEqual([
            '16px',
            '16px',
            '16px',
            '16px',
        ])
        const cardStyle = card().style
        expect(cardStyle.maxWidth).toBe('')
        expect(cardStyle.maxHeight).toBe('')
        expect(cardStyle.width).not.toMatch(/%/)
        expect(cardStyle.height).not.toMatch(/%/)
    })

    it('closes on a click on the backdrop next to the window', () => {
        render()
        press(backdrop())
        expect(isClosed()).toBe(true)
    })

    it('stays open for clicks inside the window', () => {
        render()
        press(card())
        press(container.querySelector(frameSelector))
        expect(isClosed()).toBe(false)
    })

    it('stays open when a press starts inside and is released on the backdrop', () => {
        render()
        press(card(), backdrop())
        expect(isClosed()).toBe(false)
    })

    it('stays open for a click whose press started before the backdrop existed', () => {
        render()
        fire(backdrop(), 'click')
        expect(isClosed()).toBe(false)
    })

    it('fills a phone screen edge to edge and is not closed by a tap on the safe-area strips', () => {
        mockWindowWidth = 390
        render()
        const overlay = backdrop().style
        expect([overlay.paddingTop, overlay.paddingRight, overlay.paddingBottom, overlay.paddingLeft]).toEqual([
            '0px',
            '0px',
            '0px',
            '0px',
        ])
        press(backdrop())
        expect(isClosed()).toBe(false)
    })
})
