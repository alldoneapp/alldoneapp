/**
 * @jest-environment jsdom
 *
 * security audit 2026-11 (IframeModal/trustedOrigin-derived-from-writable-preconfig-task-link):
 * the address of an iframe task is a pre-configured task's `link`, which project members can write.
 * The page it names must never be trusted because of that: only an allowlisted Alldone origin gets
 * user data, the alldone.team token, Gold and the roadmap source.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

const mockRunHttpsCallableFunction = jest.fn()
const mockSubscribeToRoadmapProject = jest.fn(() => () => {})
let mockUrl

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            iframeModalData: { visible: true, url: mockUrl, name: 'Planted' },
            loggedUser: { uid: 'victimUid', email: 'victim@example.test', userName: 'Victim', gold: 500 },
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
    getActiveRoadmapProjects: () => [{ id: 'projShared' }, { id: 'projPrivateB' }],
    getRoadmapNavigationPath: jest.fn(),
    subscribeToRoadmapProject: (...args) => mockSubscribeToRoadmapProject(...args),
}))

const IframeModal = require('./IframeModal').default
const { getTrustedEmbedOrigin, isRoadmapUrl } = require('./EmbeddedAppFrame')

const ATTACKER_ORIGIN = 'https://attacker.example'

describe('IframeModal with a page outside the allowlist', () => {
    let container
    let root
    let iframeWindow
    let iframePostMessage
    let postedOnMount

    const send = async data => {
        const event = new MessageEvent('message', { data, origin: ATTACKER_ORIGIN })
        Object.defineProperty(event, 'source', { value: iframeWindow })
        await act(async () => {
            window.dispatchEvent(event)
        })
    }

    beforeEach(() => {
        mockUrl = `${ATTACKER_ORIGIN}/embed/create-roadmap`
        global.IS_REACT_ACT_ENVIRONMENT = true
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'log').mockImplementation(() => {})
        postedOnMount = []
        // Record anything posted into the frame, including the mount-time ROADMAP_PROJECTS push.
        const original = window.HTMLIFrameElement.prototype
        const descriptor = Object.getOwnPropertyDescriptor(original, 'contentWindow')
        jest.spyOn(original, 'contentWindow', 'get').mockImplementation(function () {
            const win = descriptor.get.call(this)
            if (win && !win.__recorded) {
                win.__recorded = true
                jest.spyOn(win, 'postMessage').mockImplementation((...args) => postedOnMount.push(args))
            }
            return win
        })
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => root.render(<IframeModal />))
        iframeWindow = container.querySelector('iframe').contentWindow
        iframePostMessage = iframeWindow.postMessage
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        jest.restoreAllMocks()
        mockRunHttpsCallableFunction.mockReset()
        mockSubscribeToRoadmapProject.mockClear()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it('still renders the page', () => {
        expect(container.querySelector('iframe').getAttribute('src')).toBe(mockUrl)
    })

    it('pushes no project list into it', () => {
        expect(postedOnMount).toEqual([])
    })

    it('gives it no user data, no Gold and no roadmap, even from its own origin and window', async () => {
        await send({ type: 'GET_USER_DATA' })
        await send({ type: 'DEDUCT_GOLD', amount: 450 })
        await send({ type: 'REFUND_GOLD', amount: 450 })
        await send({ type: 'GET_ALLDONE_TOKEN' })
        await send({ type: 'ROADMAP_PROJECTS_REQUEST', protocolVersion: 1 })
        await send({ type: 'ROADMAP_PROJECT_SUBSCRIBE', protocolVersion: 1, projectId: 'projPrivateB' })

        expect(mockRunHttpsCallableFunction).not.toHaveBeenCalled()
        expect(mockSubscribeToRoadmapProject).not.toHaveBeenCalled()
        expect(iframePostMessage).not.toHaveBeenCalled()
    })
})

describe('getTrustedEmbedOrigin', () => {
    it('trusts only the allowlisted Alldone origin', () => {
        expect(getTrustedEmbedOrigin('https://alldone.team/embed/create-roadmap')).toBe('https://alldone.team')
        expect(getTrustedEmbedOrigin('https://attacker.example/embed/create-roadmap')).toBeNull()
        expect(getTrustedEmbedOrigin('https://alldone.team.attacker.example/x')).toBeNull()
        expect(getTrustedEmbedOrigin('http://alldone.team/x')).toBeNull()
        expect(getTrustedEmbedOrigin('https://user:pw@alldone.team/x')).toBeNull()
        expect(getTrustedEmbedOrigin('not a url')).toBeNull()
    })

    it('requires the trusted origin for the roadmap capability, not just its path', () => {
        expect(isRoadmapUrl('https://alldone.team/embed/create-roadmap')).toBe(true)
        expect(isRoadmapUrl('https://attacker.example/embed/create-roadmap')).toBe(false)
    })
})
