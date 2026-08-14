import { getEscapeStackSize, installEscapeStack, pushEscapeHandler, resetEscapeStack } from './escapeStack'

// jsdom does not run react-native-web, so a "swallowed" Escape is modelled the
// way react-native-web actually swallows it: a listener partway up the tree that
// calls stopPropagation, exactly like TextInput's own keydown handler does inside
// React's root container.
const mountRootContainer = ({ swallowsKeys }) => {
    const root = document.createElement('div')
    root.id = 'root'
    const input = document.createElement('input')
    root.appendChild(input)
    document.body.appendChild(root)

    if (swallowsKeys) {
        root.addEventListener('keydown', event => event.stopPropagation())
    }
    return { root, input }
}

const pressEscape = (target, init = {}) => {
    const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        ...init,
    })
    target.dispatchEvent(event)
    return event
}

describe('escapeStack', () => {
    let uninstall

    beforeEach(() => {
        jest.useFakeTimers()
        document.body.innerHTML = ''
        resetEscapeStack()
        uninstall = installEscapeStack()
    })

    afterEach(() => {
        uninstall()
        resetEscapeStack()
        jest.useRealTimers()
    })

    describe('the defect it exists for', () => {
        it('reaches a registered handler even when the key never leaves the app tree', () => {
            // This is AT-2257 in one assertion. react-native-web's TextInput calls
            // e.stopPropagation() on every keydown and React attaches its
            // listeners at the root container, so a document bubble-phase
            // listener — what every popup used — never fires.
            const { input } = mountRootContainer({ swallowsKeys: true })
            const bubbleListener = jest.fn()
            document.addEventListener('keydown', bubbleListener)

            const onEscape = jest.fn()
            pushEscapeHandler(onEscape)

            pressEscape(input)

            expect(onEscape).toHaveBeenCalledTimes(1)
            document.removeEventListener('keydown', bubbleListener)
        })

        it('replays a swallowed Escape for popups that still use their own document listener', () => {
            const { input } = mountRootContainer({ swallowsKeys: true })
            const legacyPopup = jest.fn()
            document.addEventListener('keydown', legacyPopup)

            pressEscape(input)
            // Nothing arrived: that is the bug.
            expect(legacyPopup).not.toHaveBeenCalled()

            jest.runAllTimers()
            expect(legacyPopup).toHaveBeenCalledTimes(1)
            expect(legacyPopup.mock.calls[0][0].key).toBe('Escape')

            document.removeEventListener('keydown', legacyPopup)
        })

        it('gives the replayed event the keyCode dialect react-dismissible and hotkeys-js read', () => {
            const { input } = mountRootContainer({ swallowsKeys: true })
            const legacyPopup = jest.fn()
            document.addEventListener('keydown', legacyPopup)

            pressEscape(input)
            jest.runAllTimers()

            expect(legacyPopup.mock.calls[0][0].keyCode).toBe(27)
            expect(legacyPopup.mock.calls[0][0].which).toBe(27)
            document.removeEventListener('keydown', legacyPopup)
        })

        it('does not replay when the event completed its trip on its own', () => {
            // The bridge is self-limiting: the day react-native-web stops calling
            // stopPropagation, it must go quiet rather than double-fire.
            const { input } = mountRootContainer({ swallowsKeys: false })
            const legacyPopup = jest.fn()
            document.addEventListener('keydown', legacyPopup)

            pressEscape(input)
            expect(legacyPopup).toHaveBeenCalledTimes(1)

            jest.runAllTimers()
            expect(legacyPopup).toHaveBeenCalledTimes(1)

            document.removeEventListener('keydown', legacyPopup)
        })

        it('never replays its own replay', () => {
            const { input } = mountRootContainer({ swallowsKeys: true })
            const legacyPopup = jest.fn()
            document.addEventListener('keydown', legacyPopup)

            pressEscape(input)
            jest.runAllTimers()
            jest.runAllTimers()

            expect(legacyPopup).toHaveBeenCalledTimes(1)
            document.removeEventListener('keydown', legacyPopup)
        })
    })

    describe('nesting', () => {
        it('offers the key to the most recently registered layer first', () => {
            const modal = jest.fn()
            const picker = jest.fn()
            pushEscapeHandler(modal)
            pushEscapeHandler(picker)

            pressEscape(document.body)

            expect(picker).toHaveBeenCalledTimes(1)
            expect(modal).not.toHaveBeenCalled()
        })

        it('lets the layer underneath take the next keypress once the top one unmounts', () => {
            const modal = jest.fn()
            const picker = jest.fn()
            pushEscapeHandler(modal)
            const removePicker = pushEscapeHandler(picker)

            pressEscape(document.body)
            removePicker()
            pressEscape(document.body)

            expect(picker).toHaveBeenCalledTimes(1)
            expect(modal).toHaveBeenCalledTimes(1)
        })

        it('stops a consumed key reaching the legacy listeners underneath', () => {
            // Otherwise the picker closing would also close the modal behind it:
            // both used to hang off `document`, where stopPropagation cannot stop
            // a sibling listener on the same node.
            const { input } = mountRootContainer({ swallowsKeys: false })
            const legacyPopup = jest.fn()
            document.addEventListener('keydown', legacyPopup)
            pushEscapeHandler(jest.fn())

            pressEscape(input)
            jest.runAllTimers()

            expect(legacyPopup).not.toHaveBeenCalled()
            document.removeEventListener('keydown', legacyPopup)
        })

        it('passes the key down to the next layer when a handler declines', () => {
            const modal = jest.fn()
            const inertLayer = jest.fn(() => false)
            pushEscapeHandler(modal)
            pushEscapeHandler(inertLayer)

            pressEscape(document.body)

            expect(inertLayer).toHaveBeenCalledTimes(1)
            expect(modal).toHaveBeenCalledTimes(1)
        })

        it('skips a layer that reports itself disabled without losing its place', () => {
            const modal = jest.fn()
            const picker = jest.fn()
            let pickerEnabled = false
            pushEscapeHandler(modal)
            pushEscapeHandler(picker, { isEnabled: () => pickerEnabled })

            pressEscape(document.body)
            expect(modal).toHaveBeenCalledTimes(1)
            expect(picker).not.toHaveBeenCalled()

            pickerEnabled = true
            pressEscape(document.body)
            expect(picker).toHaveBeenCalledTimes(1)
            expect(modal).toHaveBeenCalledTimes(1)
        })

        it('survives a handler that unregisters itself while the key is being dispatched', () => {
            // The normal case: the handler closes its popup, which unmounts and
            // removes its own entry mid-iteration.
            const modal = jest.fn()
            pushEscapeHandler(modal)
            const removeSelf = pushEscapeHandler(() => removeSelf())

            expect(() => pressEscape(document.body)).not.toThrow()
            expect(getEscapeStackSize()).toBe(1)
            expect(modal).not.toHaveBeenCalled()
        })
    })

    describe('conflicting nested interactions', () => {
        it('leaves Escape to a native select, which closes its own dropdown', () => {
            const select = document.createElement('select')
            document.body.appendChild(select)
            const onEscape = jest.fn()
            pushEscapeHandler(onEscape)

            pressEscape(select)

            expect(onEscape).not.toHaveBeenCalled()
        })

        it("leaves Escape to Quill's open toolbar picker", () => {
            const picker = document.createElement('span')
            picker.className = 'ql-picker ql-expanded'
            document.body.appendChild(picker)
            const onEscape = jest.fn()
            pushEscapeHandler(onEscape)

            pressEscape(document.body)

            expect(onEscape).not.toHaveBeenCalled()
        })

        it('leaves Escape to an in-progress IME composition', () => {
            const onEscape = jest.fn()
            pushEscapeHandler(onEscape)

            pressEscape(document.body, { isComposing: true })

            expect(onEscape).not.toHaveBeenCalled()
        })

        it('ignores every key that is not Escape', () => {
            const onEscape = jest.fn()
            pushEscapeHandler(onEscape)

            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

            expect(onEscape).not.toHaveBeenCalled()
        })

        it('does not preventDefault, so Escape keeps its browser-level meaning', () => {
            pushEscapeHandler(jest.fn())
            const event = pressEscape(document.body)
            expect(event.defaultPrevented).toBe(false)
        })
    })

    describe('installation', () => {
        it('detaches only once the last holder and the last layer are gone', () => {
            const onEscape = jest.fn()
            const remove = pushEscapeHandler(onEscape)

            uninstall()
            pressEscape(document.body)
            expect(onEscape).toHaveBeenCalledTimes(1)

            remove()
            const orphan = jest.fn()
            document.addEventListener('keydown', orphan)
            pressEscape(document.body)
            jest.runAllTimers()
            // The dispatcher is gone: nothing was replayed on top of the real event.
            expect(orphan).toHaveBeenCalledTimes(1)
            document.removeEventListener('keydown', orphan)
        })

        it('is safe to uninstall twice', () => {
            const stop = installEscapeStack()
            stop()
            expect(() => stop()).not.toThrow()
        })
    })
})
