/**
 * @jest-environment jsdom
 *
 * AT-2189 regression: the swipe "postpone" popup was not visible on mobile.
 *
 * These drive the REAL (patched) react-tiny-popover and the REAL viewport math
 * from utils/popoverPositioning, because the failure modes only appear once
 * those two are combined:
 *   1. an unclamped centred contentLocation placed the portal above the top
 *      edge of a short phone viewport,
 *   2. the compatibility mouse events a touch device replays after the swipe
 *      release reached the popover's own window `click` listener and dismissed
 *      the popup in the frame it appeared, and
 *   3. the dominant one, which survived the first two fixes: with a centred
 *      target every candidate position violates on a phone, and the popover
 *      gave up mid-render - portal and overlay mounted, container left at
 *      opacity 0. See __tests__/UIComponents/ReactTinyPopoverNoFittingPosition
 *      for the library-level contract.
 *
 * TARGET GEOMETRY MATTERS. Version one of this suite mocked every non-container
 * element - the Popover's target included - as 0x0 at (0, 0), which put the
 * target in the top-left corner where the 'right' position is viable. That hid
 * mode 3 completely. The target is an empty <Text /> inside a full-screen
 * overlay that centres its children, so it must be modelled CENTRED.
 */
import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'

const PHONE_WIDTH = 390
const PHONE_HEIGHT = 664

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

const setViewport = (width, height) => {
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

describe('DueDateSinglePopup on a phone viewport', () => {
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
        setViewport(PHONE_WIDTH, PHONE_HEIGHT)
        // react-tiny-popover's outside-click handler consults the selection.
        window.getSelection = () => ({ toString: () => '' })

        host = document.createElement('div')
        document.body.appendChild(host)

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
                const midX = PHONE_WIDTH / 2
                const midY = PHONE_HEIGHT / 2
                return { top: midY, left: midX, width: 0, height: 0, right: midX, bottom: midY }
            }
            return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }
        })
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

    // The reported symptom, and the one that survived the first round of fixes:
    // the overlay mounted and locked the rest of the UI, but the popup itself
    // stayed invisible. No position fits a 305x450 modal around a centred target
    // on a 390x664 phone, and the popover used to abandon the render at that
    // point - leaving the container at its initial opacity 0, with the
    // contentLocation helper never called (so also at top 0 / left 0).
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
        expect(top).toBe((PHONE_HEIGHT - 450) / 2)
        expect(left).toBe((PHONE_WIDTH - 304) / 2)
    })

    // The failing case: a reminder modal taller than a short phone viewport used
    // to be centred to a negative top, so its header and close button rendered
    // above the top edge and the popup read as "not visible".
    it('keeps a popup taller than the viewport on screen', () => {
        contentSize = { width: 304, height: 900 }

        const popover = mount()
        const { top, left } = geometry(popover)

        // Assert visibility as well: an abandoned render leaves the container at
        // top/left 0, which would satisfy the bounds checks vacuously.
        expect(popover.style.opacity).toBe('1')
        expect(top).toBeGreaterThanOrEqual(0)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(top).toBeLessThan(PHONE_HEIGHT)
    })

    it('keeps the popup on screen when the desktop sidebar offset is applied on a narrow viewport', () => {
        mockState.smallScreenNavigation = false

        const popover = mount()
        const { left } = geometry(popover)

        expect(popover.style.opacity).toBe('1')
        expect(left).toBeGreaterThanOrEqual(0)
        expect(left + contentSize.width).toBeLessThanOrEqual(PHONE_WIDTH)
    })
})

describe('DueDateSinglePopup opening-gesture dismissal guard', () => {
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
        setViewport(PHONE_WIDTH, PHONE_HEIGHT)
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
