/**
 * @jest-environment jsdom
 *
 * AT-2243 regression: after saving the Gmail labeling model in Settings >
 * Integrations, clicking outside the calendar/email settings popup made the
 * popup impossible to reopen — the next calendar or email "Settings" popup
 * never appeared again.
 *
 * The sequence that kept the popup dead was a pair of bugs in the vendored
 * react-tiny-popover dist (replacement_node_modules/react-tiny-popover):
 *
 *  1. A listener leak. Every popover open registered an anonymous
 *     `window.addEventListener('mouseup', ...)` in updatePopover that was
 *     never removed on teardown (componentWillUnmount / removePopover only
 *     removed click, keydown and resize). Each open therefore left another
 *     mouseup listener behind that re-armed `window.preventPopoverClose` on
 *     any outside gesture — swallowing genuine outside clicks in the next
 *     popover.
 *
 *  2. The opener's own outside mouseup. The close button in the app defers
 *     its close (components/FollowUp/CloseButton.js), so when a click lands
 *     on the header close button the popover is still mounted when the
 *     window `mouseup` of that same gesture fires. Upstream that mouseup
 *     re-armed `preventPopoverClose` while the popover still covered the
 *     underlying "Settings" toggle; the app's click-through guard then
 *     re-opened the settings popup and the deferred close hid it again,
 *     leaving the float-popup lock acquired forever, so every later open
 *     early-returned.
 *
 * These tests drive the REAL patched library through its own
 * updatePopover/removePopover lifecycle and pin: (a) the mouseup listener
 * registered on open is removed on teardown, and (b) an outside mouseup that
 * arrives while a popover is still mounted neither locks the popover open
 * nor dismisses it — a genuine outside click afterwards still dismisses.
 */
import Popover from 'react-tiny-popover/dist/Popover'

const makePopover = (overrides = {}) =>
    new Popover({
        isOpen: true,
        onClickOutside: jest.fn(),
        content: 'content',
        children: null,
        ...overrides,
    })

const mockLayout = () => {
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
        top: 40,
        left: 40,
        width: 0,
        height: 0,
        right: 40,
        bottom: 40,
    }))
}

describe('react-tiny-popover outside-close lifecycle', () => {
    let popover
    let originalResizeObserver
    let originalGetSelection

    beforeEach(() => {
        originalResizeObserver = global.ResizeObserver
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        originalGetSelection = window.getSelection
        window.getSelection = () => ({ toString: () => '' })
        mockLayout()
        popover = makePopover()
        // Real DOM target/popover nodes (componentDidMount would have produced
        // them; updatePopover registers the listeners itself). renderPopover,
        // which recurses position candidates and setState, is orthogonal to
        // the listener lifecycle.
        popover.willMount = false
        popover.target = document.createElement('span')
        document.body.appendChild(popover.target)
        popover.popoverDiv = document.createElement('div')
        document.body.appendChild(popover.popoverDiv)
        popover.props.position = ['bottom']
        popover.positionOrder = ['bottom']
        popover.renderPopover = () => {}
    })

    afterEach(() => {
        if (popover.popoverDiv && popover.popoverDiv.parentNode) {
            popover.popoverDiv.parentNode.removeChild(popover.popoverDiv)
        }
        // Stub setState for the final teardown so it does not warn while the
        // component is deliberately unmounted (same pattern the library's own
        // lifecycle follows via componentWillUnmount).
        popover.setState = () => undefined
        popover.willUnmount = true
        popover.removePopover()
        if (popover.target && popover.target.parentNode) {
            popover.target.parentNode.removeChild(popover.target)
        }
        window.clickStartedInPopover = undefined
        window.preventPopoverClose = undefined
        global.ResizeObserver = originalResizeObserver
        window.getSelection = originalGetSelection
        jest.restoreAllMocks()
    })

    it('removes the popover mouseup listener when the popover closes', () => {
        let registered
        const originalAdd = window.addEventListener.bind(window)
        window.addEventListener = (type, handler, ...rest) => {
            if (type === 'mouseup') registered = handler
            return originalAdd(type, handler, ...rest)
        }
        popover.updatePopover(true)
        expect(registered).not.toBeUndefined()

        // Unmount: the portal div leaves the DOM, then final teardown runs.
        const popoverDiv = popover.popoverDiv
        popoverDiv.parentNode.removeChild(popoverDiv)

        let removed
        const originalRemove = window.removeEventListener.bind(window)
        window.removeEventListener = (type, handler, ...rest) => {
            if (type === 'mouseup') removed = handler
            return originalRemove(type, handler, ...rest)
        }
        // The library's own componentWillUnmount calls setState while the
        // component is unmounted; stub it so the teardown stays warning-clean.
        popover.setState = () => undefined
        popover.willUnmount = true
        popover.removePopover()

        expect(removed).toBe(registered)
    })

    it('consumes the opener outside mouseup once without dismissing, then a genuine outside click still dismisses', () => {
        popover.updatePopover(true)
        const popoverDiv = popover.popoverDiv
        // The click is OUTSIDE the popover and its target. jsdom has no
        // layout, so model containment explicitly.
        jest.spyOn(popoverDiv, 'contains').mockReturnValue(false)
        jest.spyOn(popover.target, 'contains').mockReturnValue(false)
        const outsideTarget = document.createElement('div')
        document.body.appendChild(outsideTarget)

        // Path 2 (see file header): the settings popup is STILL mounted when
        // the window mouseup of the closing gesture fires, and that mouseup
        // targets the underlying page, not the popover.
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, target: outsideTarget }))

        const onClickOutside = popover.props.onClickOutside
        onClickOutside.mockClear()

        // A genuine later outside click must still dismiss. Upstream the
        // opener's mouseup re-armed `preventPopoverClose`; the fix consumes
        // that vote, so the genuine gesture is honoured.
        window.dispatchEvent(new MouseEvent('click', { bubbles: true, target: outsideTarget }))
        expect(onClickOutside).toHaveBeenCalledTimes(1)
        outsideTarget.remove()
    })
})
