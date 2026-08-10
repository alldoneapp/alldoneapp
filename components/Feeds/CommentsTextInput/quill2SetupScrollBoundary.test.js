/**
 * @jest-environment jsdom
 *
 * AT-2220. Quill 2's `focus()` and `setSelection()` end in
 * `scrollSelectionIntoView()`, which walks EVERY scrollable ancestor of the
 * editor up to `document.body` and scrolls each one so the caret is inside it.
 * Quill 1 did the opposite — it restored its own container's scroll position and
 * touched nothing else — so since the Quill 2 migration, opening (or merely
 * re-focusing) an inline task editor scrolls the task list underneath it.
 *
 * `quill2Setup` confines that walk to the editor's own scroll view. This suite
 * pins the confinement: an ancestor above the boundary comes back untouched, an
 * ancestor at or below it still follows the caret, and an editor that declares
 * no boundary (the notes document editor) keeps Quill's stock behaviour.
 *
 * The wrapped function is fed a stand-in for Quill's own walk, because that walk
 * needs real layout and jsdom has none. What is under test here is the decision —
 * which containers may move — not Quill's geometry. The real algorithm against
 * real layout is covered by browser-tests/at2220.
 */
import Quill from 'quill'

import { confineScrollRectIntoView } from './quill2Setup'

jest.mock('./textInputHelper', () => ({
    getPlaceholderData: jest.fn(() => ({})),
    QUILL_EDITOR_TEXT_INPUT_TYPE: '0',
}))

const CARET = { top: 900, bottom: 924, left: 0, right: 10 }

describe('quill scroll-into-view confinement', () => {
    const buildEditor = ({ withBoundary }) => {
        const outerList = document.createElement('div')
        const boundary = document.createElement('div')
        const innerScroller = document.createElement('div')
        const root = document.createElement('div')

        outerList.appendChild(boundary)
        boundary.appendChild(innerScroller)
        innerScroller.appendChild(root)
        document.body.appendChild(outerList)

        outerList.scrollTop = 1200
        innerScroller.scrollTop = 10

        return {
            quill: { root, scrollBoundaryElement: withBoundary ? boundary : undefined },
            outerList,
            innerScroller,
        }
    }

    // What Quill's real `scrollRectIntoView` does: scroll every ancestor it walks.
    const quillWalk = (...elements) =>
        jest.fn(function () {
            elements.forEach(element => {
                element.scrollTop += 400
            })
        })

    beforeEach(() => {
        window.scrollTo = jest.fn()
        Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true })
        Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true })
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('leaves the surrounding list exactly where the user left it', () => {
        const { quill, outerList, innerScroller } = buildEditor({ withBoundary: true })

        confineScrollRectIntoView(quillWalk(outerList, innerScroller)).call(quill, CARET)

        expect(outerList.scrollTop).toBe(1200)
    })

    it('still lets the editor scroll itself to follow the caret', () => {
        const { quill, outerList, innerScroller } = buildEditor({ withBoundary: true })

        confineScrollRectIntoView(quillWalk(outerList, innerScroller)).call(quill, CARET)

        expect(innerScroller.scrollTop).toBe(410)
    })

    it('puts the page back without animating it', () => {
        const { quill, outerList, innerScroller } = buildEditor({ withBoundary: true })
        const walk = jest.fn(function () {
            outerList.scrollTop += 400
            innerScroller.scrollTop += 400
            window.scrollY = 640
        })

        confineScrollRectIntoView(walk).call(quill, CARET)

        // `html { scroll-behavior: smooth }` would turn a plain scrollTo into a
        // visible glide — the very jump this is suppressing.
        expect(window.scrollTo).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' })
    })

    it('keeps quill stock behaviour for an editor that declares no boundary', () => {
        const { quill, outerList, innerScroller } = buildEditor({ withBoundary: false })

        confineScrollRectIntoView(quillWalk(outerList, innerScroller)).call(quill, CARET)

        expect(outerList.scrollTop).toBe(1600)
    })

    it('restores the ancestors even when quill throws', () => {
        const { quill, outerList, innerScroller } = buildEditor({ withBoundary: true })
        const walk = jest.fn(function () {
            outerList.scrollTop += 400
            innerScroller.scrollTop += 400
            throw new Error('boom')
        })

        expect(() => confineScrollRectIntoView(walk).call(quill, CARET)).toThrow('boom')
        expect(outerList.scrollTop).toBe(1200)
    })

    it('passes the caret rect and the return value straight through', () => {
        const { quill } = buildEditor({ withBoundary: true })
        const walk = jest.fn(() => 'quill result')

        expect(confineScrollRectIntoView(walk).call(quill, CARET)).toBe('quill result')
        expect(walk).toHaveBeenCalledWith(CARET)
    })

    it('is installed on the quill prototype, so every editor goes through it', () => {
        expect(Quill.prototype.scrollRectIntoView.confinesScrollToEditor).toBe(true)
    })
})
