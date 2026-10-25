/**
 * @jest-environment jsdom
 *
 * AT-2236 — "press the Search button on mobile, the popup appears but then
 * disappears again (while the notes list view is still loading)".
 *
 * The modal's backdrop covers the whole viewport, including the control that
 * opened the modal, from its first frame. react-native-web 0.21 fires `onPress`
 * from the DOM `click` event, so a press the browser had already queued while
 * the main thread was blocked — a second, impatient tap on a list that is still
 * loading, or a browser-duplicated tap — is delivered after the modal mounted
 * and lands on that backdrop.
 *
 * A press the user physically made BEFORE the modal existed can never be a
 * deliberate dismiss, and the browser tells us so: `event.timeStamp` is taken
 * when the event was created, not when it was dispatched.
 */
import React from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { overrideStore, showGlobalSearchPopup } from '../../redux/actions'
import GlobalSearchModal from './GlobalSearchModal'
import { highResNow } from '../../utils/popupDismissGuard'

jest.mock('../../utils/typesenseSearch', () => ({
    warmTypesenseSearchCredentials: jest.fn(async () => true),
    multiSearchTypesense: async searches => searches.map(() => ({ hits: [] })),
}))

jest.mock('../../utils/backends/firestore', () => {
    const actual = jest.requireActual('../../utils/backends/firestore')
    return {
        ...actual,
        getAllUserProjects: jest.fn(async () => []),
        watchUserProjects: jest.fn(),
        unwatch: jest.fn(),
        runHttpsCallableFunction: jest.fn(async () => ({})),
        spentGold: jest.fn(async () => ({ success: false })),
    }
})

const loggedUser = {
    uid: 'user-1',
    displayName: 'Karsten',
    photoURL: '',
    premium: { status: 'free' },
    realTemplateProjectIds: [],
    realGuideProjectIds: [],
    realArchivedProjectIds: [],
    archivedProjectIds: [],
    templateProjectIds: [],
    projectIds: [],
    quotaWarnings: {},
    workstreams: {},
    gold: 0,
    themeName: 'default',
    isAnonymous: false,
    sidebarExpanded: true,
}

const pressWith = (node, timeStamp) => {
    const events = ['mousedown', 'mouseup', 'click'].map(type => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
        if (timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
        return event
    })
    act(() => {
        events.forEach(event => node.dispatchEvent(event))
    })
}

// react-native-web ships its styles as atomic classes, so the backdrop has to be
// recognised through the resolved style rather than an inline one.
const isFullScreenTouchable = node => {
    const style = window.getComputedStyle(node)
    return style.position === 'absolute' && style.top === '0px' && style.bottom === '0px'
}

describe('GlobalSearchModal — a press made before it opened must not dismiss it (AT-2236)', () => {
    let container
    let root

    const render = () => {
        store.dispatch(
            overrideStore({ ...store.getState(), smallScreenNavigation: true, smallScreen: true, loggedUser })
        )
        store.dispatch(showGlobalSearchPopup(false))
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => {
            root.render(
                <Provider store={store}>
                    <GlobalSearchModal />
                </Provider>
            )
        })
        const backdrop = Array.from(container.querySelectorAll('[tabindex="0"]')).find(isFullScreenTouchable)
        expect(backdrop).toBeTruthy()
        return backdrop
    }

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete window.ontouchstart
    })

    it('ignores a backdrop press the browser queued before the modal existed', () => {
        const queuedAt = highResNow() - 5
        const backdrop = render()

        pressWith(backdrop, queuedAt)

        expect(store.getState().showGlobalSearchPopup).toBe(true)
    })

    it('still closes on a backdrop press the user made after it opened', () => {
        const backdrop = render()

        pressWith(backdrop, highResNow() + 1000)

        expect(store.getState().showGlobalSearchPopup).toBe(false)
    })

    // Measured in real Chromium with real touch input: two taps 120ms apart at
    // the same point make the second one hit-test onto the backdrop the first one
    // had just mounted, closing the modal ~135ms after it appeared.
    it('ignores the repeat tap of an impatient user on a touch device', () => {
        window.ontouchstart = null
        const backdrop = render()

        pressWith(backdrop, highResNow() + 10)

        expect(store.getState().showGlobalSearchPopup).toBe(true)
    })

    it('ignores an untimestamped press in the first moments on a touch device', () => {
        window.ontouchstart = null
        const backdrop = render()

        pressWith(backdrop, 0)

        expect(store.getState().showGlobalSearchPopup).toBe(true)
    })

    it('keeps a mouse press without a usable timestamp working on desktop', () => {
        const backdrop = render()

        pressWith(backdrop, 0)

        expect(store.getState().showGlobalSearchPopup).toBe(false)
    })

    it('still closes on Escape', () => {
        render()

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })

        expect(store.getState().showGlobalSearchPopup).toBe(false)
    })
})
