/**
 * @jest-environment jsdom
 *
 * The window `message` event is a shared bus. react-native-web's scheduler runs
 * on the `setimmediate` polyfill, which implements setImmediate as
 * `window.postMessage('setImmediate$<rand>$<handle>', '*')` on our own window —
 * so an open IframeModal used to log an "untrusted origin" warning per
 * scheduled tick. The origin check must still reject a real cross-origin
 * attempt; only traffic that was never addressed to us is dropped silently.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const mockRunHttpsCallableFunction = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            iframeModalData: {
                visible: true,
                url: 'https://alldone.team/paul-product-manager/create-roadmap?embed=true',
                name: 'Roadmap',
            },
            loggedUser: { email: 'user@example.com', userName: 'User', gold: 42 },
            loggedUserProjects: [],
        }),
}))
jest.mock('../../../../redux/actions', () => ({ setIframeModalData: () => ({ type: 'setIframeModalData' }) }))
jest.mock('../../../../hooks/useEscapeKey', () => () => {})
jest.mock('../../../../hooks/useSafeAreaOverlayPadding', () => () => ({}))
jest.mock('../../../../utils/backends/firestore', () => ({
    runHttpsCallableFunction: (...args) => mockRunHttpsCallableFunction(...args),
}))
jest.mock('../../../Icon', () => () => null)
jest.mock('../../../../utils/NavigationService', () => ({}))
jest.mock('../../../../URLSystem/URLTrigger', () => ({ processUrl: jest.fn() }))
jest.mock('../../../../utils/roadmapSourceBridge', () => ({
    ALLDONE_ROADMAP_PROTOCOL_VERSION: 1,
    getActiveRoadmapProjects: () => [],
    getRoadmapNavigationPath: jest.fn(),
    subscribeToRoadmapProject: jest.fn(),
}))

const IframeModal = require('./IframeModal').default

const TRUSTED_ORIGIN = 'https://alldone.team'
const APP_ORIGIN = 'https://my.alldone.app'

describe('IframeModal window message filtering', () => {
    let container
    let root
    let warn
    let iframeWindow
    let iframePostMessage

    const dispatchMessage = ({ data, origin, source }) =>
        act(() => {
            window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
        })

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'log').mockImplementation(() => {})
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => root.render(<IframeModal />))
        iframeWindow = container.querySelector('iframe').contentWindow
        iframePostMessage = jest.spyOn(iframeWindow, 'postMessage').mockImplementation(() => {})
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        jest.restoreAllMocks()
        mockRunHttpsCallableFunction.mockReset()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it('stays silent for the setImmediate polyfill posting to our own window', () => {
        dispatchMessage({ data: 'setImmediate$0.8237$14', origin: APP_ORIGIN, source: window })

        expect(warn).not.toHaveBeenCalled()
    })

    it('stays silent for a same-origin message object that is not part of the protocol', () => {
        dispatchMessage({ data: { type: 'webpackHotUpdate' }, origin: APP_ORIGIN, source: window })

        expect(warn).not.toHaveBeenCalled()
    })

    it('still warns and refuses a protocol message from an untrusted origin', () => {
        const event = new MessageEvent('message', {
            data: { type: 'DEDUCT_GOLD', amount: 5 },
            origin: 'https://evil.example',
        })
        Object.defineProperty(event, 'source', { value: iframeWindow })

        act(() => {
            window.dispatchEvent(event)
        })

        expect(warn).toHaveBeenCalledWith(
            'IframeModal: ignoring message from untrusted origin',
            expect.objectContaining({
                origin: 'https://evil.example',
                trustedOrigin: TRUSTED_ORIGIN,
                type: 'DEDUCT_GOLD',
            })
        )
        expect(mockRunHttpsCallableFunction).not.toHaveBeenCalled()
        expect(iframePostMessage).not.toHaveBeenCalled()
    })

    it('answers a protocol message from the trusted origin, with an alldone.team token', async () => {
        mockRunHttpsCallableFunction.mockResolvedValue({ token: 'adapp_token' })
        const event = new MessageEvent('message', { data: { type: 'GET_USER_DATA' }, origin: TRUSTED_ORIGIN })
        Object.defineProperty(event, 'source', { value: iframeWindow })

        await act(async () => {
            window.dispatchEvent(event)
        })

        expect(warn).not.toHaveBeenCalled()
        expect(mockRunHttpsCallableFunction).toHaveBeenCalledWith('getAlldoneTeamEmbedTokenSecondGen', {})
        expect(iframePostMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'USER_DATA',
                user: expect.objectContaining({ gold: 42 }),
                alldoneToken: 'adapp_token',
            }),
            TRUSTED_ORIGIN
        )
    })

    it('acknowledges the page’s Gold requests without charging once its server bills', async () => {
        const send = async data => {
            const event = new MessageEvent('message', { data, origin: TRUSTED_ORIGIN })
            Object.defineProperty(event, 'source', { value: iframeWindow })
            await act(async () => {
                window.dispatchEvent(event)
            })
        }
        mockRunHttpsCallableFunction.mockResolvedValue({ success: true, newBalance: 32 })
        await send({ type: 'DEDUCT_GOLD', amount: 10 })
        expect(mockRunHttpsCallableFunction).toHaveBeenCalledWith('deductGoldSecondGen', expect.anything())

        mockRunHttpsCallableFunction.mockClear()
        iframePostMessage.mockClear()
        await send({ type: 'ALLDONE_SERVER_BILLING' })
        await send({ type: 'DEDUCT_GOLD', amount: 10 })
        await send({ type: 'REFUND_GOLD', amount: 10 })
        expect(mockRunHttpsCallableFunction).not.toHaveBeenCalled()
        expect(iframePostMessage.mock.calls.map(([message]) => message.type)).toEqual([
            'DEDUCT_GOLD_SUCCESS',
            'REFUND_GOLD_SUCCESS',
        ])
    })

    it('renews the alldone.team token on request', async () => {
        mockRunHttpsCallableFunction.mockResolvedValue({ token: 'adapp_next' })
        const event = new MessageEvent('message', { data: { type: 'GET_ALLDONE_TOKEN' }, origin: TRUSTED_ORIGIN })
        Object.defineProperty(event, 'source', { value: iframeWindow })

        await act(async () => {
            window.dispatchEvent(event)
        })

        expect(iframePostMessage).toHaveBeenCalledWith(
            { type: 'ALLDONE_TOKEN', alldoneToken: 'adapp_next' },
            TRUSTED_ORIGIN
        )
    })

    it('ignores protocol traffic from another window even when the origin is trusted', () => {
        dispatchMessage({
            data: { type: 'ROADMAP_PROJECTS_REQUEST', protocolVersion: 1 },
            origin: TRUSTED_ORIGIN,
            source: { postMessage: jest.fn() },
        })

        expect(iframePostMessage).not.toHaveBeenCalled()
    })
})
