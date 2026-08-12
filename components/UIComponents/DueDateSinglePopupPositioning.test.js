/**
 * @jest-environment jsdom
 *
 * AT-2189 regression, updated for the ModalShell migration: the swipe
 * "postpone" popup was not visible on mobile.
 *
 * Since DueDateSinglePopup moved onto AppPopover, a phone viewport renders a
 * BottomSheet — the original failure class ("no popover position fits around
 * a centred target on a phone") is structurally impossible there, and this
 * suite pins the replacement contract instead: the sheet mounts, the
 * transparent centring overlay stops intercepting pointer events, and the
 * sheet's AT-2236 mount grace covers the replayed compatibility click.
 *
 * The popover path still exists on desktop, including SHORT/NARROW desktop
 * windows just past the sheet breakpoint — the original geometry pins run
 * there now (real patched react-tiny-popover + real viewport math from
 * utils/popoverPositioning; see __tests__/UIComponents/
 * ReactTinyPopoverNoFittingPosition for the library-level contract).
 *
 * TARGET GEOMETRY MATTERS. Version one of this suite mocked every
 * non-container element as 0x0 at (0, 0), which put the target in the
 * top-left corner where the 'right' position is viable and hid the
 * no-fitting-position mode completely. The target is an empty <Text /> inside
 * a full-screen overlay that centres its children, so it is modelled CENTRED.
 */
import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'

const PHONE_WIDTH = 390
const PHONE_HEIGHT = 664
// Just past MODAL_SHEET_BREAKPOINT (640): the popover path, on a window too
// small to fit a 304x450 modal beside a centred target.
const NARROW_DESKTOP_WIDTH = 640
const NARROW_DESKTOP_HEIGHT = 664

let viewport = { width: PHONE_WIDTH, height: PHONE_HEIGHT }

// The natural (unclamped) size the popover portal measures.
let contentSize = { width: 304, height: 450 }

const mockDispatch = jest.fn()

const mockState = {
    loggedUser: { showAllProjectsByTime: false },
    route: 'Tasks',
    selectedSidebarTab: 'Tasks',
    taskViewToggleIndex: 0,
    selectedProjectIndex: 0,
    currentUser: { uid: 'user-1' },
    smallScreenNavigation: true,
    showSwipeDueDatePopup: { data: { projectId: 'project-1', task: { id: 'task-1' } } },
}

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('./FloatModals/DueDateModal/DueDateModal', () => 'DueDateModal')
jest.mock('../../utils/BackendBridge', () => ({}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskDueDate: jest.fn(),
    setTaskToBacklog: jest.fn(),
}))
jest.mock('../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper', () => ({
    checkIfInMyDayOpenTab: jest.fn(() => false),
}))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: jest.fn(() => ({ type: 'hideFloatPopup' })),
    hideSwipeDueDatePopup: jest.fn(() => ({ type: 'hideSwipeDueDatePopup' })),
    setSwipeDueDatePopupData: jest.fn(() => ({ type: 'setSwipeDueDatePopupData' })),
}))
// utils/HelperFunctions cannot be imported in a test (it pulls in the redux
// store and react-native-dotenv), so mirror only its thin adapter and delegate
// to the real positioning module under test.
jest.mock('../../utils/HelperFunctions', () => {
    const { centerPopoverInWindow } = require('../../utils/popoverPositioning')
    const SIDEBAR_MENU_WIDTH = 263
    return {
        popoverToTopContainerStyle: { position: 'fixed' },
        popoverToCenter: (positioningData, isMobile = true) =>
            centerPopoverInWindow(positioningData, isMobile ? 0 : SIDEBAR_MENU_WIDTH / 2),
    }
})

const DueDateSinglePopup = require('./DueDateSinglePopup').default
const { highResNow } = require('../../utils/popupDismissGuard')

const setViewport = (width, height) => {
    viewport = { width, height }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height })
    window.dispatchEvent(new Event('resize'))
}

const flushTimers = async () => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
    })
}

const installLayoutMocks = host => {
    global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    // react-tiny-popover's outside-click handler consults the selection.
    window.getSelection = () => ({ toString: () => '' })

    // jsdom has no layout, so model what a real browser produces:
    //  - the portal container: the size the real modal would have, at
    //    wherever the popover just placed it;
    //  - everything in the app tree, i.e. the Popover's TARGET: a zero-size
    //    box at the CENTRE of the viewport (see the file header).
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
        if (this.classList && this.classList.contains('react-tiny-popover-container')) {
            const top = parseFloat(this.style.top) || 0
            const left = parseFloat(this.style.left) || 0
            return {
                top,
                left,
                width: contentSize.width,
                height: contentSize.height,
                right: left + contentSize.width,
                bottom: top + contentSize.height,
            }
        }
        if (host.contains(this)) {
            const midX = viewport.width / 2
            const midY = viewport.height / 2
            return { top: midY, left: midX, width: 0, height: 0, right: midX, bottom: midY }
        }
        return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }
    })
}

describe('DueDateSinglePopup on a phone viewport (sheet presentation)', () => {
    let host

    beforeEach(() => {
        mockDispatch.mockClear()
        mockState.smallScreenNavigation = true
        contentSize = { width: 304, height: 450 }
        setViewport(PHONE_WIDTH, PHONE_HEIGHT)
        host = document.createElement('div')
        document.body.appendChild(host)
        installLayoutMocks(host)
    })

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(host)
        })
        host.remove()
        jest.restoreAllMocks()
        delete window.ontouchstart
    })

    const mount = () => {
        act(() => {
            ReactDOM.render(<DueDateSinglePopup />, host)
        })
    }

    const pressBackdrop = timeStamp => {
        const backdrop = document.querySelector('[data-testid="bottom-sheet-backdrop"]')
        expect(backdrop).not.toBeNull()
        act(() => {
            ;['mousedown', 'mouseup', 'click'].forEach(type => {
                const event = new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
                Object.defineProperty(event, 'timeStamp', { value: timeStamp })
                backdrop.dispatchEvent(event)
            })
        })
    }

    it('renders the postpone modal as a bottom sheet (no invisible popover possible)', () => {
        mount()
        expect(document.querySelector('[data-testid="bottom-sheet"]')).not.toBeNull()
        expect(document.querySelector('.react-tiny-popover-container')).toBeNull()
    })

    it('the centring overlay must not intercept taps meant for the sheet backdrop', () => {
        mount()
        // The overlay sits at zIndex 10000, ABOVE the sheet backdrop (9990);
        // with pointer events it would eat every backdrop tap.
        const overlay = host.firstChild
        expect(overlay.style.pointerEvents).toBe('none')
    })

    it('ignores the replayed compatibility click but honours a genuine backdrop tap', async () => {
        // The touch device replays the opening swipe as mouse events whose
        // timeStamp predates the sheet's mount (AT-2236 / AT-2189). The guard
        // only honours timestamps SHORTLY before open, so capture it first.
        const replayedAt = highResNow() - 5
        mount()
        await flushTimers()

        pressBackdrop(replayedAt)
        await flushTimers()
        expect(mockDispatch).not.toHaveBeenCalled()

        pressBackdrop(highResNow() + 10000)
        await flushTimers()
        expect(mockDispatch).toHaveBeenCalled()
        expect(mockDispatch.mock.calls[0][0]).toEqual(expect.arrayContaining([{ type: 'hideSwipeDueDatePopup' }]))
    })
})

describe('DueDateSinglePopup on a short, narrow desktop window (popover presentation)', () => {
    let host

    beforeEach(() => {
        mockDispatch.mockClear()
        mockState.smallScreenNavigation = true
        contentSize = { width: 304, height: 450 }
        setViewport(NARROW_DESKTOP_WIDTH, NARROW_DESKTOP_HEIGHT)
        host = document.createElement('div')
        document.body.appendChild(host)
        installLayoutMocks(host)
    })

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(host)
        })
        host.remove()
        jest.restoreAllMocks()
    })

    const mount = () => {
        act(() => {
            ReactDOM.render(<DueDateSinglePopup />, host)
        })
        return document.querySelector('.react-tiny-popover-container')
    }

    const geometry = popover => ({
        top: parseFloat(popover.style.top),
        left: parseFloat(popover.style.left),
    })

    // The original AT-2189 symptom: the overlay mounted and locked the rest of
    // the UI, but the popup itself stayed invisible (container abandoned at
    // opacity 0). No position fits a 304x450 modal around a centred target on
    // a 640x664 window either, so the vendored last-candidate commit is still
    // what keeps this visible.
    it('makes the popup visible instead of leaving a locked, invisible overlay', () => {
        const popover = mount()

        expect(popover).not.toBeNull()
        expect(popover.style.opacity).toBe('1')
    })

    it('makes a popup taller than the viewport visible too', () => {
        contentSize = { width: 304, height: 900 }

        const popover = mount()

        expect(popover.style.opacity).toBe('1')
    })

    it('centres the popup in the viewport when it fits', () => {
        const popover = mount()
        const { top, left } = geometry(popover)

        expect(popover.style.position).toBe('fixed')
        expect(top).toBe((NARROW_DESKTOP_HEIGHT - 450) / 2)
        expect(left).toBe((NARROW_DESKTOP_WIDTH - 304) / 2)
    })

    // A reminder modal taller than a short viewport used to be centred to a
    // negative top, so its header and close button rendered above the top edge.
    it('keeps a popup taller than the viewport on screen', () => {
        contentSize = { width: 304, height: 900 }

        const popover = mount()
        const { top, left } = geometry(popover)

        expect(popover.style.opacity).toBe('1')
        expect(top).toBeGreaterThanOrEqual(0)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(top).toBeLessThan(NARROW_DESKTOP_HEIGHT)
    })

    it('keeps the popup on screen when the desktop sidebar offset is applied on a narrow viewport', () => {
        mockState.smallScreenNavigation = false

        const popover = mount()
        const { left } = geometry(popover)

        expect(popover.style.opacity).toBe('1')
        expect(left).toBeGreaterThanOrEqual(0)
        expect(left + contentSize.width).toBeLessThanOrEqual(NARROW_DESKTOP_WIDTH)
    })
})

describe('DueDateSinglePopup opening-gesture dismissal guard (popover presentation)', () => {
    let host

    beforeEach(() => {
        mockDispatch.mockClear()
        mockState.smallScreenNavigation = true
        contentSize = { width: 304, height: 450 }
        global.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        setViewport(NARROW_DESKTOP_WIDTH, NARROW_DESKTOP_HEIGHT)
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
            top: 0,
            left: 0,
            width: contentSize.width,
            height: contentSize.height,
            right: contentSize.width,
            bottom: contentSize.height,
        }))
        // react-tiny-popover's outside-click handler consults the selection to
        // avoid closing while the user is dragging a text selection.
        window.getSelection = () => ({ toString: () => '' })

        host = document.createElement('div')
        document.body.appendChild(host)
        act(() => {
            ReactDOM.render(<DueDateSinglePopup />, host)
        })
    })

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(host)
        })
        host.remove()
        jest.restoreAllMocks()
    })

    const clickOutside = async () => {
        await act(async () => {
            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })
        await flushTimers()
    }

    it('ignores the click the touch device replays right after the swipe release', async () => {
        // react-tiny-popover only starts honouring outside clicks after its own
        // willMount tick, so let that pass first - this is the replayed
        // compatibility click, not a user dismissal.
        await flushTimers()
        await clickOutside()

        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('still dismisses on a genuine outside click after the opening gesture', async () => {
        await flushTimers()
        await clickOutside()
        expect(mockDispatch).not.toHaveBeenCalled()

        await clickOutside()

        expect(mockDispatch).toHaveBeenCalledTimes(1)
        expect(mockDispatch.mock.calls[0][0]).toEqual(expect.arrayContaining([{ type: 'hideSwipeDueDatePopup' }]))
    })
})
