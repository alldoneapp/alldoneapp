import {
    highResNow,
    installPopupOutsideDismissGuard,
    protectModalDismissFromClickThrough,
    shouldIgnorePressFromBeforeOpen,
} from './popupDismissGuard'

describe('popup outside-dismiss guard', () => {
    let popup
    let insideButton
    let underlyingButton
    let cleanup

    beforeEach(() => {
        popup = document.createElement('div')
        insideButton = document.createElement('button')
        underlyingButton = document.createElement('button')
        popup.appendChild(insideButton)
        document.body.appendChild(popup)
        document.body.appendChild(underlyingButton)
    })

    afterEach(() => {
        cleanup?.()
        popup.remove()
        underlyingButton.remove()
    })

    const dispatch = (target, type) => {
        target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
    }

    test.each([
        ['mouse', 'mousedown', 'mouseup'],
        ['pointer', 'pointerdown', 'pointerup'],
        ['touch', 'touchstart', 'touchend'],
    ])('consumes the first outside %s gesture over an interactive element', (name, startType, releaseType) => {
        const dismiss = jest.fn()
        const underlyingAction = jest.fn()
        underlyingButton.addEventListener(releaseType, underlyingAction)
        underlyingButton.addEventListener('click', underlyingAction)
        cleanup = installPopupOutsideDismissGuard(popup, dismiss)

        dispatch(underlyingButton, startType)
        dispatch(underlyingButton, releaseType)
        underlyingButton.click()

        expect(dismiss).toHaveBeenCalledTimes(1)
        expect(underlyingAction).not.toHaveBeenCalled()

        cleanup()
        cleanup = null
        underlyingButton.click()
        expect(underlyingAction).toHaveBeenCalledTimes(1)
    })

    it('preserves normal interaction inside the popup', () => {
        const dismiss = jest.fn()
        const insideAction = jest.fn()
        insideButton.addEventListener('click', insideAction)
        cleanup = installPopupOutsideDismissGuard(popup, dismiss)

        dispatch(insideButton, 'mousedown')
        dispatch(insideButton, 'mouseup')
        insideButton.click()

        expect(dismiss).not.toHaveBeenCalled()
        expect(insideAction).toHaveBeenCalledTimes(1)
    })

    it('does not intercept a newer nested popover', () => {
        const popupContainer = document.createElement('div')
        const nestedContainer = document.createElement('div')
        const nestedButton = document.createElement('button')
        popupContainer.className = 'react-tiny-popover-container'
        nestedContainer.className = 'react-tiny-popover-container'
        popupContainer.appendChild(popup)
        nestedContainer.appendChild(nestedButton)
        document.body.appendChild(popupContainer)
        document.body.appendChild(nestedContainer)

        const dismiss = jest.fn()
        const nestedAction = jest.fn()
        nestedButton.addEventListener('click', nestedAction)
        cleanup = installPopupOutsideDismissGuard(popup, dismiss)

        dispatch(nestedButton, 'mousedown')
        dispatch(nestedButton, 'mouseup')
        nestedButton.click()

        expect(dismiss).not.toHaveBeenCalled()
        expect(nestedAction).toHaveBeenCalledTimes(1)

        popupContainer.remove()
        nestedContainer.remove()
    })

    it('consumes the trailing mobile-web events after a focus action reorders the list', () => {
        const underlyingAction = jest.fn()
        underlyingButton.addEventListener('mousedown', underlyingAction)
        underlyingButton.addEventListener('mouseup', underlyingAction)
        underlyingButton.addEventListener('click', underlyingAction)

        protectModalDismissFromClickThrough({
            nativeEvent: { type: 'touchend' },
            stopPropagation: jest.fn(),
        })

        dispatch(underlyingButton, 'mousedown')
        dispatch(underlyingButton, 'mouseup')
        underlyingButton.click()

        expect(underlyingAction).not.toHaveBeenCalled()

        underlyingButton.click()
        expect(underlyingAction).toHaveBeenCalledTimes(1)
    })
})

// AT-2236: a full-screen modal opened by a press covers the control that opened
// it. A press the browser had queued while the main thread was blocked arrives
// after the modal mounted and would dismiss it instantly, even though the user
// made it before the modal existed.
describe('press-made-before-open guard', () => {
    afterEach(() => {
        delete window.ontouchstart
    })

    it('ignores a press whose timestamp predates the open', () => {
        const openedAt = highResNow()
        expect(shouldIgnorePressFromBeforeOpen({ timeStamp: openedAt - 1 }, openedAt)).toBe(true)
    })

    it('lets a press made after the open through', () => {
        const openedAt = highResNow() - 5000
        expect(shouldIgnorePressFromBeforeOpen({ timeStamp: highResNow() }, openedAt)).toBe(false)
    })

    it('reads the timestamp off the native event when the wrapper has none', () => {
        const openedAt = highResNow()
        expect(shouldIgnorePressFromBeforeOpen({ nativeEvent: { timeStamp: openedAt - 1 } }, openedAt)).toBe(true)
    })

    it('ignores epoch-millisecond timestamps instead of comparing them', () => {
        // Legacy engines report Date.now() here; it must not be read as a
        // time-origin value (it would look like a press from the far future).
        const openedAt = highResNow() - 5000
        expect(shouldIgnorePressFromBeforeOpen({ timeStamp: Date.now() }, openedAt)).toBe(false)
    })

    it('ignores a repeat tap made before the user could have seen the modal', () => {
        window.ontouchstart = null
        // Measured in real Chromium: the second of two taps 120ms apart lands on
        // the backdrop the first one mounted, ~135ms after it appeared.
        expect(shouldIgnorePressFromBeforeOpen({ timeStamp: highResNow() }, highResNow() - 135)).toBe(true)
        expect(shouldIgnorePressFromBeforeOpen({}, highResNow())).toBe(true)
    })

    it('honours a deliberate dismiss tap once the modal has been on screen', () => {
        window.ontouchstart = null
        expect(shouldIgnorePressFromBeforeOpen({ timeStamp: highResNow() }, highResNow() - 5000)).toBe(false)
        expect(shouldIgnorePressFromBeforeOpen({}, highResNow() - 5000)).toBe(false)
    })

    it('never blocks an untimestamped press on a desktop pointer', () => {
        expect(shouldIgnorePressFromBeforeOpen({}, highResNow())).toBe(false)
    })

    it('honours a press that looks queued for longer than any real jank', () => {
        // A `timeStamp` from a different time origin must not make the backdrop
        // permanently unresponsive.
        const openedAt = highResNow()
        expect(shouldIgnorePressFromBeforeOpen({ timeStamp: openedAt - 60000 }, openedAt)).toBe(false)
    })

    it('does nothing when the caller has no open time yet', () => {
        expect(shouldIgnorePressFromBeforeOpen({ timeStamp: 1 }, undefined)).toBe(false)
    })
})
