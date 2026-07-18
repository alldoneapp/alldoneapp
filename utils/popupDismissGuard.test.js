import { installRichCommentOutsideDismissGuard } from './popupDismissGuard'

describe('rich comment outside-dismiss guard', () => {
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
        cleanup = installRichCommentOutsideDismissGuard(popup, dismiss)

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
        cleanup = installRichCommentOutsideDismissGuard(popup, dismiss)

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
        cleanup = installRichCommentOutsideDismissGuard(popup, dismiss)

        dispatch(nestedButton, 'mousedown')
        dispatch(nestedButton, 'mouseup')
        nestedButton.click()

        expect(dismiss).not.toHaveBeenCalled()
        expect(nestedAction).toHaveBeenCalledTimes(1)

        popupContainer.remove()
        nestedContainer.remove()
    })
})
