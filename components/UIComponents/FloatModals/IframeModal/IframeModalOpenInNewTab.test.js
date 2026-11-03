/**
 * @jest-environment jsdom
 *
 * AT-2954: the embed window's header carries, immediately left of the X, a button that opens the
 * app's current page in a new browser tab and closes the window. "Current" is what the app reported
 * through EMBED_LOCATION (a cross-origin frame cannot be read), otherwise the start URL. Drives the
 * REAL IframeModal with the REAL EmbeddedAppFrame, so the message checks are the shipped ones.
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
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))
jest.mock('../../../Icon', () => props => <i data-icon={props.name} />)
jest.mock('../../../../utils/NavigationService', () => ({}))
jest.mock('../../../../URLSystem/URLTrigger', () => ({ processUrl: jest.fn() }))
jest.mock('../../../../utils/roadmapSourceBridge', () => ({
    ALLDONE_ROADMAP_PROTOCOL_VERSION: 1,
    getActiveRoadmapProjects: () => [],
    getRoadmapNavigationPath: jest.fn(),
    subscribeToRoadmapProject: jest.fn(),
}))

const IframeModal = require('./IframeModal').default

const START = 'https://alldone.team/connor-consultant/story-builder'
const ORIGIN = 'https://alldone.team'
const BUTTON = '[data-testid="embed-open-in-new-tab"]'

describe('opening the embedded app in a new tab (AT-2954)', () => {
    let container
    let root
    let open
    let iframeWindow

    const render = () => act(() => root.render(<IframeModal />))
    const press = () => act(() => container.querySelector(BUTTON).click())
    const report = (url, { origin = ORIGIN, source = iframeWindow } = {}) => {
        const event = new MessageEvent('message', { data: { type: 'EMBED_LOCATION', url }, origin })
        Object.defineProperty(event, 'source', { value: source })
        act(() => {
            window.dispatchEvent(event)
        })
    }
    const closed = () => mockDispatch.mock.calls.some(([action]) => action.visible === false)

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        mockState = {
            iframeModalData: { visible: true, url: START, name: 'Story Builder' },
            loggedUser: { uid: 'u1', email: 'user@example.com', isAnonymous: false },
            loggedUserProjects: [],
            defaultAssistant: null,
        }
        mockDispatch.mockClear()
        open = jest.spyOn(window, 'open').mockReturnValue({ opener: window })
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        render()
        iframeWindow = container.querySelector('iframe').contentWindow
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        jest.restoreAllMocks()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it('sits immediately left of the X, labelled for assistive technology and with a tooltip', () => {
        const button = container.querySelector(BUTTON)
        expect(button).toBeTruthy()
        expect(button.getAttribute('role')).toBe('button')
        expect(button.getAttribute('aria-label')).toBe('Open app in new tab')
        expect(button.querySelector('[title="Open app in new tab"]')).toBeTruthy()
        expect(button.querySelector('[data-icon="new-window"]')).toBeTruthy()

        const close = button.nextElementSibling
        expect(close.querySelector('[data-icon="x"]')).toBeTruthy()
        expect(close.getAttribute('aria-label')).toBe('Close')
    })

    it('opens the start URL when the app never reported a page, and closes the window', () => {
        press()
        expect(open).toHaveBeenCalledWith(START, '_blank')
        expect(closed()).toBe(true)
    })

    it('opens the page the app reported last', () => {
        report(`${START}/story-1?step=2`)
        report(`${START}/story-1?step=3#outline`)
        press()
        expect(open).toHaveBeenCalledWith(`${START}/story-1?step=3#outline`, '_blank')
        expect(closed()).toBe(true)
    })

    it('ignores a report from another origin, another window or for another site', () => {
        report(`${START}/from-evil`, { origin: 'https://evil.example' })
        report(`${START}/from-other-window`, { source: { postMessage: jest.fn() } })
        report('https://evil.example/phish')
        report('javascript:alert(1)')
        press()
        expect(open).toHaveBeenCalledWith(START, '_blank')
    })

    it('keeps the window open and explains a blocked pop-up', () => {
        open.mockReturnValue(null)
        press()
        expect(closed()).toBe(false)
        expect(container.textContent).toContain('embedded_app_popup_blocked')
        expect(container.querySelector('iframe')).toBeTruthy()

        // Allowed on the next try: opens and closes.
        open.mockReturnValue({})
        press()
        expect(closed()).toBe(true)
    })

    it('forgets the reported page when another app opens', () => {
        report(`${START}/story-1`)
        const other = 'https://alldone.team/judy-job/job-radar'
        mockState = { ...mockState, iframeModalData: { visible: true, url: other, name: 'Job Radar' } }
        render()
        press()
        expect(open).toHaveBeenCalledWith(other, '_blank')
    })
})
