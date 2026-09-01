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
            iframeModalData: { visible: true, url: 'https://alldone.team/roadmap', name: 'Roadmap' },
            loggedUser: { email: 'user@example.com', userName: 'User', gold: 42 },
        }),
}))
jest.mock('../../../../redux/actions', () => ({ setIframeModalData: () => ({ type: 'setIframeModalData' }) }))
jest.mock('../../../../hooks/useEscapeKey', () => () => {})
jest.mock('../../../../hooks/useSafeAreaOverlayPadding', () => () => ({}))
jest.mock('../../../../utils/backends/firestore', () => ({
    runHttpsCallableFunction: (...args) => mockRunHttpsCallableFunction(...args),
}))
jest.mock('../../../Icon', () => () => null)

const IframeModal = require('./IframeModal').default

const TRUSTED_ORIGIN = 'https://alldone.team'
const APP_ORIGIN = 'https://my.alldone.app'

describe('IframeModal window message filtering', () => {
    let container
    let root
    let warn

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
        const source = { postMessage: jest.fn() }
        const event = new MessageEvent('message', {
            data: { type: 'DEDUCT_GOLD', amount: 5 },
            origin: 'https://evil.example',
        })
        Object.defineProperty(event, 'source', { value: source })

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
        expect(source.postMessage).not.toHaveBeenCalled()
    })

    it('answers a protocol message from the trusted origin', () => {
        const source = { postMessage: jest.fn() }
        const event = new MessageEvent('message', { data: { type: 'GET_USER_DATA' }, origin: TRUSTED_ORIGIN })
        Object.defineProperty(event, 'source', { value: source })

        act(() => {
            window.dispatchEvent(event)
        })

        expect(warn).not.toHaveBeenCalled()
        expect(source.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'USER_DATA', user: expect.objectContaining({ gold: 42 }) }),
            TRUSTED_ORIGIN
        )
    })
})
