import {
    findScrollParent,
    resetDetailedViewScroll,
    revealElementInScrollParent,
    scrollDocumentToTop,
    scrollRefToTop,
} from './scrollUtils'

describe('scrollUtils', () => {
    beforeEach(() => {
        window.scrollTo = jest.fn()
        document.documentElement.scrollTop = 200
        document.documentElement.scrollLeft = 20
        document.body.scrollTop = 300
        document.body.scrollLeft = 30
    })

    it('resets every browser document scroll holder', () => {
        scrollDocumentToTop()

        expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
        expect(document.documentElement.scrollTop).toBe(0)
        expect(document.documentElement.scrollLeft).toBe(0)
        expect(document.body.scrollTop).toBe(0)
        expect(document.body.scrollLeft).toBe(0)
    })

    it('resets a CustomScrollView through its imperative ref', () => {
        const scrollTo = jest.fn()

        scrollRefToTop({ current: { scrollTo } })

        expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false })
    })

    it('resets both document and detail-view scrolling together', () => {
        const scrollTo = jest.fn()

        resetDetailedViewScroll({ current: { scrollTo } })

        expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
        expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false })
    })
})

/**
 * AT-2220. jsdom has no layout, so the geometry is injected: `getBoundingClientRect`
 * is stubbed per element and `clientHeight`/`scrollHeight` are defined as own
 * properties. That is enough to pin the DECISION this helper makes — how far to
 * scroll, and when not to — which is the part the ticket is about. The real
 * layout is exercised in browser-tests/at2220.
 */
describe('revealElementInScrollParent', () => {
    const SCROLLER_HEIGHT = 500

    const layout = (element, { top, height }) => {
        element.getBoundingClientRect = () => ({
            top,
            bottom: top + height,
            left: 0,
            right: 300,
            width: 300,
            height,
            x: 0,
            y: top,
        })
    }

    const buildScroller = ({ scrollTop = 0, contentHeight = 5000 } = {}) => {
        const scroller = document.createElement('div')
        scroller.style.overflowY = 'auto'
        Object.defineProperty(scroller, 'clientHeight', { value: SCROLLER_HEIGHT, configurable: true })
        Object.defineProperty(scroller, 'scrollHeight', { value: contentHeight, configurable: true })
        scroller.scrollTop = scrollTop
        layout(scroller, { top: 0, height: SCROLLER_HEIGHT })

        const editor = document.createElement('div')
        scroller.appendChild(editor)
        document.body.appendChild(scroller)
        return { scroller, editor }
    }

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('finds the nearest scrolling ancestor and ignores non-scrolling wrappers', () => {
        const { scroller, editor } = buildScroller()
        const wrapper = document.createElement('div')
        wrapper.style.overflowY = 'visible'
        Object.defineProperty(wrapper, 'clientHeight', { value: 100, configurable: true })
        Object.defineProperty(wrapper, 'scrollHeight', { value: 100, configurable: true })
        editor.appendChild(wrapper)

        expect(findScrollParent(wrapper)).toBe(scroller)
    })

    it('does not scroll an editor that already fits', () => {
        const { scroller, editor } = buildScroller({ scrollTop: 900 })
        layout(editor, { top: 120, height: 130 })

        expect(revealElementInScrollParent(editor, 8)).toBe(0)
        expect(scroller.scrollTop).toBe(900)
    })

    it('scrolls by exactly what the editor needs when it hangs off the bottom', () => {
        const { scroller, editor } = buildScroller({ scrollTop: 900 })
        // 40px past the bottom, plus the 8px breathing room asked for.
        layout(editor, { top: 410, height: 130 })

        expect(revealElementInScrollParent(editor, 8)).toBe(48)
        expect(scroller.scrollTop).toBe(948)
    })

    it('pulls an editor that is cut off at the top back down', () => {
        const { scroller, editor } = buildScroller({ scrollTop: 900 })
        layout(editor, { top: -20, height: 130 })

        expect(revealElementInScrollParent(editor, 8)).toBe(-28)
        expect(scroller.scrollTop).toBe(872)
    })

    it('aligns the top rather than pushing it out of view for an over-tall editor', () => {
        const { scroller, editor } = buildScroller({ scrollTop: 900 })
        // Taller than the visible area: revealing the bottom would hide the input.
        layout(editor, { top: 100, height: 900 })

        expect(revealElementInScrollParent(editor, 8)).toBe(92)
        expect(scroller.scrollTop).toBe(992)
    })

    it('never scrolls past the end of the list', () => {
        const { scroller, editor } = buildScroller({ scrollTop: 4480, contentHeight: 5000 })
        layout(editor, { top: 410, height: 130 })

        // Only 20px of scroll range is left (5000 - 500 - 4480).
        expect(revealElementInScrollParent(editor, 8)).toBe(20)
        expect(scroller.scrollTop).toBe(4500)
    })

    it('does nothing when there is no scrolling ancestor at all', () => {
        const orphan = document.createElement('div')
        layout(orphan, { top: 900, height: 130 })
        document.body.appendChild(orphan)

        expect(revealElementInScrollParent(orphan, 8)).toBe(0)
    })
})
