import {
    CHAT_EDGE_BOTTOM,
    CHAT_EDGE_TOP,
    CHAT_FULLSCREEN_TOLERANCE_DESKTOP,
    CHAT_FULLSCREEN_TOLERANCE_MOBILE,
    CHAT_FULLSCREEN_TOLERANCE_TABLET,
    CHAT_NORMAL_TOLERANCE_DESKTOP,
    CHAT_NORMAL_TOLERANCE_MOBILE,
    CHAT_NORMAL_TOLERANCE_TABLET,
    getChatFullscreenTolerances,
    resolveChatFullscreenChange,
} from './chatScrollFullscreen'

const { enter, exit } = getChatFullscreenTolerances({})

// A thread far longer than the viewport, so both edges are reachable and the middle is wide.
const LONG_THREAD = { contentHeight: 4000, viewportHeight: 800 }
const MAX_SCROLL = LONG_THREAD.contentHeight - LONG_THREAD.viewportHeight

const resolve = (scrollY, isFullscreen, thread = LONG_THREAD) =>
    resolveChatFullscreenChange({ ...thread, scrollY, isFullscreen, enter, exit })

describe('chat fullscreen tolerances', () => {
    it('scales with the breakpoint', () => {
        expect(getChatFullscreenTolerances({ mobile: true })).toEqual({
            enter: CHAT_FULLSCREEN_TOLERANCE_MOBILE,
            exit: CHAT_NORMAL_TOLERANCE_MOBILE,
        })
        expect(getChatFullscreenTolerances({ tablet: true })).toEqual({
            enter: CHAT_FULLSCREEN_TOLERANCE_TABLET,
            exit: CHAT_NORMAL_TOLERANCE_TABLET,
        })
        expect(getChatFullscreenTolerances({})).toEqual({
            enter: CHAT_FULLSCREEN_TOLERANCE_DESKTOP,
            exit: CHAT_NORMAL_TOLERANCE_DESKTOP,
        })
    })

    it('leaves room for the chrome the DV drops when expanding', () => {
        // Entering makes the viewport taller by the chrome's height, which moves the position
        // closer to the bottom. Without this gap the new state would immediately exit again.
        ;[{ mobile: true }, { tablet: true }, {}].forEach(breakpoint => {
            const tolerances = getChatFullscreenTolerances(breakpoint)
            expect(tolerances.enter - tolerances.exit).toBeGreaterThan(80)
        })
    })
})

describe('resolveChatFullscreenChange', () => {
    it('expands once the reader is away from both edges', () => {
        expect(resolve(MAX_SCROLL / 2, false)).toEqual({ fullscreen: true, edge: null })
    })

    it('stays normal while resting at the newest message', () => {
        expect(resolve(MAX_SCROLL, false)).toBeNull()
        expect(resolve(MAX_SCROLL - exit, false)).toBeNull()
        expect(resolve(MAX_SCROLL - enter, false)).toBeNull()
    })

    it('stays normal while resting at the beginning of the thread', () => {
        expect(resolve(0, false)).toBeNull()
        expect(resolve(enter, false)).toBeNull()
    })

    it('restores the normal layout at the bottom and names the edge', () => {
        expect(resolve(MAX_SCROLL, true)).toEqual({ fullscreen: false, edge: CHAT_EDGE_BOTTOM })
        expect(resolve(MAX_SCROLL - exit, true)).toEqual({ fullscreen: false, edge: CHAT_EDGE_BOTTOM })
    })

    it('restores the normal layout at the top and names the edge', () => {
        expect(resolve(0, true)).toEqual({ fullscreen: false, edge: CHAT_EDGE_TOP })
        expect(resolve(exit, true)).toEqual({ fullscreen: false, edge: CHAT_EDGE_TOP })
    })

    it('keeps the expanded layout through the middle', () => {
        expect(resolve(MAX_SCROLL / 2, true)).toBeNull()
        expect(resolve(exit + 1, true)).toBeNull()
    })

    it('never expands a thread that barely scrolls', () => {
        const short = { contentHeight: 800 + enter, viewportHeight: 800 }
        for (let scrollY = 0; scrollY <= enter; scrollY += 8) {
            expect(resolve(scrollY, false, short)).toBeNull()
        }
    })

    it('collapses a thread that stopped being scrollable while expanded', () => {
        const notScrollable = { contentHeight: 400, viewportHeight: 800 }
        expect(resolve(0, true, notScrollable)).toEqual({ fullscreen: false, edge: CHAT_EDGE_BOTTOM })
    })

    it('treats overscroll past an edge as being at that edge', () => {
        // Web rubber banding reports positions outside the scrollable range.
        expect(resolve(-120, true)).toEqual({ fullscreen: false, edge: CHAT_EDGE_TOP })
        expect(resolve(MAX_SCROLL + 120, true)).toEqual({ fullscreen: false, edge: CHAT_EDGE_BOTTOM })
        expect(resolve(-120, false)).toBeNull()
        expect(resolve(MAX_SCROLL + 120, false)).toBeNull()
    })

    it('does not flap when entering fullscreen frees the chrome height', () => {
        const chromeHeight = 80
        const entered = resolve(MAX_SCROLL - enter - 1, false)
        expect(entered).toEqual({ fullscreen: true, edge: null })

        // Same scroll position, taller viewport: the reader is now nearer the bottom.
        const afterLayout = resolveChatFullscreenChange({
            scrollY: MAX_SCROLL - enter - 1,
            contentHeight: LONG_THREAD.contentHeight,
            viewportHeight: LONG_THREAD.viewportHeight + chromeHeight,
            isFullscreen: true,
            enter,
            exit,
        })
        expect(afterLayout).toBeNull()
    })
})
