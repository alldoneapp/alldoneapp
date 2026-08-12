import {
    KEYBOARD_OPEN_CLASS,
    KEYBOARD_INSET_CSS_VAR,
    KEYBOARD_REVEAL_MARGIN_PX,
    applyKeyboardInset,
    getCaretRect,
    isEditableElement,
    isLayoutViewportShrunk,
    measureKeyboardInset,
    resetDocumentScrollForKeyboard,
    revealFocusedInput,
    startVirtualKeyboardViewport,
} from './virtualKeyboard'

/**
 * AT-2248. jsdom has no layout and no virtual keyboard, so both are injected:
 * `visualViewport` is a hand-rolled event target whose height the test moves, and
 * element geometry is stubbed the same way `scrollUtils.test.js` does it. That is
 * enough to pin the DECISIONS this module makes — when a shrink counts as a
 * keyboard, how far to scroll and, above all, when NOT to scroll — which is the
 * part that regresses. Real keyboard geometry can only be checked on a device.
 */

const LAYOUT_HEIGHT = 800
const SCROLLER_HEIGHT = 500
const KEYBOARD_HEIGHT = 300

const setLayoutHeight = height => {
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true })
}

const installVisualViewport = ({ height = LAYOUT_HEIGHT, offsetTop = 0 } = {}) => {
    const listeners = {}
    const viewport = {
        height,
        offsetTop,
        addEventListener: jest.fn((type, handler) => {
            listeners[type] = listeners[type] || new Set()
            listeners[type].add(handler)
        }),
        removeEventListener: jest.fn((type, handler) => {
            if (listeners[type]) listeners[type].delete(handler)
        }),
        emit: type => {
            ;(listeners[type] || []).forEach(handler => handler())
        },
        listenerCount: type => (listeners[type] ? listeners[type].size : 0),
    }
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true, writable: true })
    return viewport
}

const rectAt = (top, height) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    height,
    x: 0,
    y: top,
})

/**
 * Stub geometry that RESPONDS to its scroller, which matters more than it looks:
 * the module re-runs its reveal several times while the keyboard animates in, so
 * a static rect would let each pass scroll again and hide the very property
 * worth pinning — that a second pass over an already-visible field does nothing.
 */
const layoutIn = (element, { top, height }, scroller) => {
    const baseScrollTop = scroller ? scroller.scrollTop : 0
    element.getBoundingClientRect = () => rectAt(top - (scroller ? scroller.scrollTop - baseScrollTop : 0), height)
}

const layout = (element, box) => layoutIn(element, box, null)

/**
 * A scroller with `contentHeight` of content, laid out from the top of the
 * screen, holding one field at `fieldTop` (viewport coordinates).
 */
const buildSurface = ({
    fieldTop = 700,
    fieldHeight = 40,
    scrollerHeight = SCROLLER_HEIGHT,
    contentHeight = 5000,
    scrollTop = 0,
    field = document.createElement('input'),
} = {}) => {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'clientHeight', { value: scrollerHeight, configurable: true })
    Object.defineProperty(scroller, 'scrollHeight', { value: contentHeight, configurable: true })
    scroller.scrollTop = scrollTop
    layout(scroller, { top: 0, height: scrollerHeight })

    scroller.appendChild(field)
    document.body.appendChild(scroller)
    layoutIn(field, { top: fieldTop, height: fieldHeight }, scroller)

    return { scroller, field }
}

beforeEach(() => {
    document.body.innerHTML = ''
    document.documentElement.className = ''
    document.documentElement.style.removeProperty(KEYBOARD_INSET_CSS_VAR)
    setLayoutHeight(LAYOUT_HEIGHT)
})

afterEach(() => {
    delete window.visualViewport
})

describe('measureKeyboardInset', () => {
    it('is zero without a visualViewport, so untouched browsers stay untouched', () => {
        expect(measureKeyboardInset()).toBe(0)
    })

    it('reports the strip of the layout viewport the keyboard covers', () => {
        installVisualViewport({ height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT })

        expect(measureKeyboardInset()).toBe(KEYBOARD_HEIGHT)
    })

    it('measures from the BOTTOM of a visual viewport the browser has scrolled down', () => {
        // offsetTop is how far the visual viewport sits below the layout one, so
        // the covered strip is what is left under its bottom edge — 250, not 300.
        // Getting this backwards would over-shrink the shell by the offset.
        installVisualViewport({ height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT, offsetTop: 50 })

        expect(measureKeyboardInset()).toBe(LAYOUT_HEIGHT - (LAYOUT_HEIGHT - KEYBOARD_HEIGHT) - 50)
    })

    it('never reports a negative inset (pinch-zoom makes the visual viewport smaller in width, not height)', () => {
        installVisualViewport({ height: LAYOUT_HEIGHT + 40 })

        expect(measureKeyboardInset()).toBe(0)
    })

    it('reports ~0 when the browser resized the LAYOUT viewport instead (Android resizes-content)', () => {
        setLayoutHeight(LAYOUT_HEIGHT - KEYBOARD_HEIGHT)
        installVisualViewport({ height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT })

        expect(measureKeyboardInset()).toBe(0)
    })
})

describe('applyKeyboardInset', () => {
    it('publishes the inset and flags the shell so the CSS can shrink it', () => {
        expect(applyKeyboardInset(KEYBOARD_HEIGHT)).toBe(true)
        expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(true)
        expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe(`${KEYBOARD_HEIGHT}px`)
    })

    it('ignores a collapsing URL bar rather than shrinking the shell while the user scrolls', () => {
        expect(applyKeyboardInset(80)).toBe(false)
        expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false)
        expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe('0px')
    })

    it('restores the shell when the keyboard closes', () => {
        applyKeyboardInset(KEYBOARD_HEIGHT)
        applyKeyboardInset(0)

        expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false)
        expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe('0px')
    })
})

describe('isLayoutViewportShrunk', () => {
    it('recognises the Android layout-viewport resize as an open keyboard', () => {
        expect(isLayoutViewportShrunk(LAYOUT_HEIGHT, LAYOUT_HEIGHT - KEYBOARD_HEIGHT)).toBe(true)
    })

    it('does not mistake a URL-bar-sized change for one', () => {
        expect(isLayoutViewportShrunk(LAYOUT_HEIGHT, LAYOUT_HEIGHT - 80)).toBe(false)
    })
})

describe('isEditableElement', () => {
    it.each([
        ['input', () => document.createElement('input')],
        ['textarea', () => document.createElement('textarea')],
        [
            'contenteditable (Quill)',
            () => {
                const node = document.createElement('div')
                node.setAttribute('contenteditable', 'true')
                return node
            },
        ],
    ])('accepts %s', (_label, create) => {
        expect(isEditableElement(create())).toBe(true)
    })

    it.each(['checkbox', 'radio', 'submit', 'file', 'range'])('rejects an <input type=%s>', type => {
        const input = document.createElement('input')
        input.setAttribute('type', type)

        expect(isEditableElement(input)).toBe(false)
    })

    it('rejects a plain element and a missing one', () => {
        expect(isEditableElement(document.createElement('div'))).toBe(false)
        expect(isEditableElement(null)).toBe(false)
    })
})

describe('getCaretRect', () => {
    const buildEditable = () => {
        const editor = document.createElement('div')
        editor.setAttribute('contenteditable', 'true')
        const textNode = document.createTextNode('typing')
        editor.appendChild(textNode)
        document.body.appendChild(editor)
        return { editor, textNode }
    }

    it('returns the LAST client rect, which is where the caret is', () => {
        const { editor, textNode } = buildEditable()
        window.getSelection = () => ({
            rangeCount: 1,
            getRangeAt: () => ({
                startContainer: textNode,
                getClientRects: () => [rectAt(100, 18), rectAt(140, 18)],
            }),
        })

        expect(getCaretRect(editor).top).toBe(140)
    })

    it('is null for a native input, which exposes no caret geometry at all', () => {
        const input = document.createElement('input')
        document.body.appendChild(input)

        expect(getCaretRect(input)).toBeNull()
    })

    it('is null when the selection lives in a different element', () => {
        const { editor } = buildEditable()
        const elsewhere = document.createTextNode('other')
        document.body.appendChild(document.createElement('p')).appendChild(elsewhere)
        window.getSelection = () => ({
            rangeCount: 1,
            getRangeAt: () => ({ startContainer: elsewhere, getClientRects: () => [rectAt(140, 18)] }),
        })

        expect(getCaretRect(editor)).toBeNull()
    })

    it('falls back to the range box when a collapsed range reports no rects', () => {
        const { editor, textNode } = buildEditable()
        window.getSelection = () => ({
            rangeCount: 1,
            getRangeAt: () => ({
                startContainer: textNode,
                getClientRects: () => [],
                getBoundingClientRect: () => rectAt(210, 18),
            }),
        })

        expect(getCaretRect(editor).top).toBe(210)
    })

    it('is null when even the fallback is empty, so the caller uses the element box', () => {
        const { editor, textNode } = buildEditable()
        window.getSelection = () => ({
            rangeCount: 1,
            getRangeAt: () => ({
                startContainer: textNode,
                getClientRects: () => [],
                getBoundingClientRect: () => rectAt(0, 0),
            }),
        })

        expect(getCaretRect(editor)).toBeNull()
    })
})

describe('revealFocusedInput', () => {
    it('lifts a field hidden behind the keyboard by the smallest amount that clears it', () => {
        // The shell has already shrunk to 500px, and the field's bottom sits at
        // 740 — 240px below the fold.
        const { scroller, field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })

        const scrolled = revealFocusedInput(field)

        expect(scrolled).toBe(740 - SCROLLER_HEIGHT + KEYBOARD_REVEAL_MARGIN_PX)
        expect(scroller.scrollTop).toBe(252)
    })

    it('leaves an already visible field exactly where it is', () => {
        const { scroller, field } = buildSurface({ fieldTop: 100, fieldHeight: 40, scrollTop: 120 })

        expect(revealFocusedInput(field)).toBe(0)
        expect(scroller.scrollTop).toBe(120)
    })

    it('keeps the correction inside the 8-16px margin band rather than jumping', () => {
        // One pixel of the field is cut off: the correction must be that pixel
        // plus the margin, never a scroll-into-view style re-centring.
        const { scroller, field } = buildSurface({ fieldTop: 461, fieldHeight: 40 })

        const scrolled = revealFocusedInput(field)

        expect(scrolled).toBe(1 + KEYBOARD_REVEAL_MARGIN_PX)
        expect(scrolled).toBeLessThanOrEqual(16 + 1)
        expect(scroller.scrollTop).toBe(13)
    })

    it('does nothing for a non-editable element, so a tap on a button cannot scroll the list', () => {
        const button = document.createElement('button')
        const { scroller } = buildSurface({ field: button })

        expect(revealFocusedInput(button)).toBe(0)
        expect(scroller.scrollTop).toBe(0)
    })

    it('does nothing when the field has no scroll container to move', () => {
        const field = document.createElement('input')
        document.body.appendChild(field)
        layout(field, { top: 700, height: 40 })

        expect(revealFocusedInput(field)).toBe(0)
    })

    describe('multiline / contenteditable', () => {
        const buildEditor = ({ editorTop, editorHeight, caretTop, caretHeight = 18 }) => {
            const editor = document.createElement('div')
            editor.setAttribute('contenteditable', 'true')
            const { scroller } = buildSurface({ field: editor, fieldTop: editorTop, fieldHeight: editorHeight })

            const textNode = document.createTextNode('typing')
            editor.appendChild(textNode)
            const baseScrollTop = scroller.scrollTop
            window.getSelection = () => ({
                rangeCount: 1,
                getRangeAt: () => ({
                    startContainer: textNode,
                    // The caret travels with the scroller too, exactly like the box.
                    getClientRects: () => {
                        const top = caretTop - (scroller.scrollTop - baseScrollTop)
                        return [{ top, bottom: top + caretHeight, height: caretHeight, left: 20, right: 21, width: 1 }]
                    },
                }),
            })
            return { scroller, editor }
        }

        it('follows the caret when the editor is taller than the space the keyboard left', () => {
            // A 600px note editor cannot fit in the 500px that is left, so
            // revealing its box would be meaningless — the caret is what has to
            // be visible.
            const { scroller, editor } = buildEditor({ editorTop: 0, editorHeight: 600, caretTop: 560 })

            const scrolled = revealFocusedInput(editor)

            expect(scrolled).toBe(560 + 18 - SCROLLER_HEIGHT + KEYBOARD_REVEAL_MARGIN_PX)
            expect(scroller.scrollTop).toBe(90)
        })

        it('does not move when the caret is already comfortably visible', () => {
            const { scroller, editor } = buildEditor({ editorTop: 0, editorHeight: 600, caretTop: 200 })

            expect(revealFocusedInput(editor)).toBe(0)
            expect(scroller.scrollTop).toBe(0)
        })

        it('reveals the whole composer, not just the caret, while it still fits', () => {
            // A two-line task input: showing only the caret would leave its
            // action bar behind the keyboard, which is the AT-2220 complaint.
            const { scroller, editor } = buildEditor({ editorTop: 400, editorHeight: 120, caretTop: 410 })

            const scrolled = revealFocusedInput(editor)

            expect(scrolled).toBe(520 - SCROLLER_HEIGHT + KEYBOARD_REVEAL_MARGIN_PX)
            expect(scroller.scrollTop).toBe(32)
        })

        it('falls back to the editor box when the caret rect cannot be resolved', () => {
            const { scroller, editor } = buildEditor({ editorTop: 0, editorHeight: 600, caretTop: 560 })
            window.getSelection = () => ({ rangeCount: 0 })

            revealFocusedInput(editor)

            // Taller than the visible area, so it is top-aligned rather than
            // scrolled past — never pushing the start of the editor out of view.
            expect(scroller.scrollTop).toBe(0)
        })
    })
})

describe('resetDocumentScrollForKeyboard', () => {
    it("undoes the browser's own keyboard avoidance so the top bar cannot be scrolled away", () => {
        document.documentElement.scrollTop = 180
        document.body.scrollTop = 90

        resetDocumentScrollForKeyboard()

        expect(document.documentElement.scrollTop).toBe(0)
        expect(document.body.scrollTop).toBe(0)
    })
})

describe('startVirtualKeyboardViewport', () => {
    let rafSpy

    beforeEach(() => {
        jest.useFakeTimers()
        // Deferred, not synchronous: a mock that invokes the callback inline runs
        // it BEFORE the module can store the frame handle, which wedges the
        // once-per-frame guard for the rest of the test — an artifact of the
        // mock that real rAF never produces.
        rafSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => setTimeout(callback, 0))
    })

    afterEach(() => {
        rafSpy.mockRestore()
        jest.useRealTimers()
    })

    it('is inert without a visualViewport, leaving desktop browsers alone', () => {
        const stop = startVirtualKeyboardViewport()

        expect(typeof stop).toBe('function')
        expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false)
        stop()
    })

    it('shrinks the shell and reveals the focused input when the keyboard opens', () => {
        const viewport = installVisualViewport()
        const { scroller, field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT
        viewport.emit('resize')
        jest.runAllTimers()

        expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(true)
        expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe(`${KEYBOARD_HEIGHT}px`)
        expect(scroller.scrollTop).toBe(252)
        stop()
    })

    it('does not scroll anything while the keyboard is closed', () => {
        const viewport = installVisualViewport()
        const { scroller, field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        field.dispatchEvent(new Event('focusin', { bubbles: true }))
        jest.runAllTimers()

        expect(scroller.scrollTop).toBe(0)
        stop()
    })

    it('reveals a field focused while the keyboard is already up', () => {
        const viewport = installVisualViewport({ height: LAYOUT_HEIGHT - KEYBOARD_HEIGHT })
        const { scroller, field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        field.dispatchEvent(new Event('focusin', { bubbles: true }))
        jest.runAllTimers()

        expect(scroller.scrollTop).toBe(252)
        stop()
    })

    it('follows the caret on typing, and only while the keyboard is open', () => {
        const viewport = installVisualViewport()
        const { scroller, field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        document.dispatchEvent(new Event('selectionchange'))
        jest.runAllTimers()
        // Keyboard closed: typing must never move the page. This is the guard
        // that keeps the feature off desktop entirely.
        expect(scroller.scrollTop).toBe(0)

        viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT
        viewport.emit('resize')
        jest.runAllTimers()
        expect(scroller.scrollTop).toBe(252)

        // Every further keystroke re-checks and finds nothing to do — the reason
        // it is safe to run this on `selectionchange` and `input` at all.
        document.dispatchEvent(new Event('selectionchange'))
        document.dispatchEvent(new Event('input', { bubbles: true }))
        jest.runAllTimers()
        expect(scroller.scrollTop).toBe(252)
        stop()
    })

    it('brings the caret back when typing pushes it under the keyboard', () => {
        const viewport = installVisualViewport()
        const { scroller, field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT
        viewport.emit('resize')
        jest.runAllTimers()

        // The user scrolls the field back out of sight, then keeps typing.
        scroller.scrollTop = 0
        document.dispatchEvent(new Event('input', { bubbles: true }))
        jest.runAllTimers()

        expect(scroller.scrollTop).toBe(252)
        stop()
    })

    it('treats an Android layout-viewport resize as an open keyboard without shrinking again', () => {
        const viewport = installVisualViewport()
        const { scroller, field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        // The browser shrank the layout viewport itself: there is no inset left
        // to measure, and shrinking the shell on top of it would double up.
        setLayoutHeight(LAYOUT_HEIGHT - KEYBOARD_HEIGHT)
        viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT
        viewport.emit('resize')
        jest.runAllTimers()

        expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false)
        expect(scroller.scrollTop).toBe(252)
        stop()
    })

    it("undoes the browser's keyboard scroll once, then leaves the page alone", () => {
        const viewport = installVisualViewport()
        const { field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        document.documentElement.scrollTop = 180
        viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT
        viewport.emit('resize')
        jest.runAllTimers()
        expect(document.documentElement.scrollTop).toBe(0)

        // The keyboard is still up and the user scrolls a screen that has no
        // inner scroller. Further viewport events must not yank them back.
        document.documentElement.scrollTop = 240
        viewport.emit('scroll')
        viewport.emit('resize')
        jest.runAllTimers()

        expect(document.documentElement.scrollTop).toBe(240)
        stop()
    })

    it('releases the shell and every listener on teardown', () => {
        const viewport = installVisualViewport()
        const { field } = buildSurface({ fieldTop: 700, fieldHeight: 40 })
        const stop = startVirtualKeyboardViewport()

        field.focus()
        viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT
        viewport.emit('resize')
        jest.runAllTimers()
        stop()

        expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false)
        expect(document.documentElement.style.getPropertyValue(KEYBOARD_INSET_CSS_VAR)).toBe('0px')
        expect(viewport.listenerCount('resize')).toBe(0)
        expect(viewport.listenerCount('scroll')).toBe(0)
    })
})
