import { CHAT_STICK_TO_BOTTOM_TOLERANCE, resolveStickToBottom, shouldPinToBottom } from './chatAutoScroll'
import { CHAT_FULLSCREEN_TOLERANCE_MOBILE } from './chatScrollFullscreen'

const VIEWPORT = 800
const CONTENT = 4000
const MAX_SCROLL = CONTENT - VIEWPORT

const at = scrollY => resolveStickToBottom({ scrollY, contentHeight: CONTENT, viewportHeight: VIEWPORT })

describe('resolveStickToBottom', () => {
    it('is pinned at the newest message', () => {
        expect(at(MAX_SCROLL)).toBe(true)
    })

    it('is pinned a few pixels short of the bottom', () => {
        // Sub-pixel layout rounding and an in-flight momentum frame both land here, and treating
        // that as "the reader went browsing" is the whole of AT-2439.
        expect(at(MAX_SCROLL - 1)).toBe(true)
        expect(at(MAX_SCROLL - CHAT_STICK_TO_BOTTOM_TOLERANCE)).toBe(true)
    })

    it('stands down once the reader is properly up in the thread', () => {
        expect(at(MAX_SCROLL - CHAT_STICK_TO_BOTTOM_TOLERANCE - 1)).toBe(false)
        expect(at(0)).toBe(false)
    })

    // The defect this module replaces: the flag was one-way, so scrolling up and coming back left
    // the chat permanently unfollowed until the next send. Position is the ONLY input now, so the
    // return trip is answered by the same call that answered the trip up.
    it('re-arms purely from position, with no memory of having scrolled away', () => {
        expect(at(MAX_SCROLL / 2)).toBe(false)
        expect(at(MAX_SCROLL)).toBe(true)
    })

    it('treats a thread too short to scroll as pinned', () => {
        expect(resolveStickToBottom({ scrollY: 0, contentHeight: 200, viewportHeight: VIEWPORT })).toBe(true)
    })

    // Web rubber-banding reports positions outside the range; the shared clamp in
    // chatScrollFullscreen keeps a bounce at the bottom from reading as "somewhere in the middle".
    it('survives overscroll in both directions', () => {
        expect(at(MAX_SCROLL + 120)).toBe(true)
        expect(at(-120)).toBe(false)
    })

    it('handles a missing/zero geometry without throwing', () => {
        expect(resolveStickToBottom({})).toBe(true)
    })

    it('accepts an explicit tolerance', () => {
        expect(at(MAX_SCROLL - 200)).toBe(false)
        expect(
            resolveStickToBottom({
                scrollY: MAX_SCROLL - 200,
                contentHeight: CONTENT,
                viewportHeight: VIEWPORT,
                tolerance: 300,
            })
        ).toBe(true)
    })

    // A position that still counts as pinned must never be one that expanded the layout, or the
    // two mechanisms would disagree about where the reader is.
    it('stays inside the tightest fullscreen-enter tolerance', () => {
        expect(CHAT_STICK_TO_BOTTOM_TOLERANCE).toBeLessThan(CHAT_FULLSCREEN_TOLERANCE_MOBILE)
    })
})

describe('shouldPinToBottom', () => {
    it('pins when content grows under a pinned reader', () => {
        expect(shouldPinToBottom({ stickToBottom: true, contentHeight: 4200, previousContentHeight: 4000 })).toBe(true)
    })

    it('leaves a reader who went up alone', () => {
        expect(shouldPinToBottom({ stickToBottom: false, contentHeight: 4200, previousContentHeight: 4000 })).toBe(
            false
        )
    })

    // React Native Web re-reports the content size on layout passes that resized nothing. Acting
    // on those would yank the position out from under a reader dragging at the very bottom of the
    // thread — inside the tolerance, so still pinned — on every frame.
    it('ignores a report that changed nothing', () => {
        expect(shouldPinToBottom({ stickToBottom: true, contentHeight: 4000, previousContentHeight: 4000 })).toBe(false)
    })

    // A deleted comment or a collapsing card can leave the position past the new bottom.
    it('pins when content shrinks too', () => {
        expect(shouldPinToBottom({ stickToBottom: true, contentHeight: 3800, previousContentHeight: 4000 })).toBe(true)
    })

    it('pins on the first report, when nothing was measured yet', () => {
        expect(shouldPinToBottom({ stickToBottom: true, contentHeight: 4000, previousContentHeight: 0 })).toBe(true)
    })
})
