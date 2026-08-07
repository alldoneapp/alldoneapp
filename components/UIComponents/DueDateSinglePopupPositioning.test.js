/**
 * @jest-environment jsdom
 *
 * AT-2189 regression: the swipe "postpone" popup was not visible on mobile.
 *
 * These drive the REAL (patched) react-tiny-popover and the REAL viewport math
 * from utils/popoverPositioning, because both failure modes only appear once
 * those two are combined:
 *   1. an unclamped centred contentLocation placed the portal above the top
 *      edge of a short phone viewport, and
 *   2. the compatibility mouse events a touch device replays after the swipe
 *      release reached the popover's own window `click` listener and dismissed
 *      the popup in the frame it appeared.
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

        // jsdom has no layout: give the portal container the size the real modal
        // would have, positioned wherever the popover just placed it.
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
            return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }
        })

        host = document.createElement('div')
        document.body.appendChild(host)
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

        expect(top).toBeGreaterThanOrEqual(0)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(top).toBeLessThan(PHONE_HEIGHT)
    })

    it('keeps the popup on screen when the desktop sidebar offset is applied on a narrow viewport', () => {
        mockState.smallScreenNavigation = false

        const popover = mount()
        const { left } = geometry(popover)

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
