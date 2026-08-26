import { useCallback, useEffect, useRef, useState } from 'react'

import { resolveStickToBottom, shouldPinToBottom } from '../../components/ChatsView/Utils/chatAutoScroll'

// An upper bound on how long a smooth scroll to the newest message may be in flight. It is a
// safety net, not the mechanism: the grace normally ends the moment the scroller reports that it
// arrived, or that the reader took over (see `handleScrollPosition`).
export const SMOOTH_SCROLL_MAX_MS = 700

/**
 * Keeps a chat scroller parked on the newest message, and offers a way back when it is not
 * (AT-2439).
 *
 * The rule is in `chatAutoScroll.js`; this owns the wiring, which is the half that is easy to get
 * wrong. Three different reports can put the newest message out of view and each needs its own
 * hook-up — missing any one of them is what made the old implementation unreliable in a way that
 * looked random to the user:
 *
 *   - `onContentSizeChange` — the load-bearing one. A message's height is NOT final on the render
 *     that introduced it (markdown, code blocks, images and attachments settle a frame or more
 *     later, and a streamed answer grows for as long as it is being written), so anything that
 *     scrolls on "a message changed" alone aims at the previous content height and stops short.
 *     This report arrives after the height is real, and again for every later growth.
 *   - the newest-message signal — the fast one. A plain-text message whose height is final on
 *     first render gets to the bottom within a tick instead of waiting for a layout pass, and a
 *     re-render that reuses the exact same content height reports no content-size change at all.
 *   - `onLayout` — the viewport can shrink instead of the content growing (mobile keyboard, a
 *     composer growing to several lines). That changes no content size and fires no scroll event,
 *     so nothing else would notice.
 *
 * The pin lives in a ref rather than state on purpose: it is written on every scroll frame and
 * read only by those sites, so keeping it out of the render cycle avoids re-rendering the whole
 * message list while the user drags. `hasNewMessagesBelow` is the one piece that must render, and
 * it is mirrored in a ref so the scroll path only ever calls `setState` on an actual change.
 */
export default function useChatAutoScroll({ scrollViewRef, newestMessageSignal }) {
    // Starts pinned: opening a chat puts you on the newest message.
    const stickToBottomRef = useRef(true)
    const contentHeightRef = useRef(0)
    const lastScrollYRef = useRef(0)
    const smoothScrollUntilRef = useRef(0)
    const [hasNewMessagesBelow, setHasNewMessagesBelowState] = useState(false)
    const hasNewMessagesBelowRef = useRef(false)

    const setHasNewMessagesBelow = useCallback(value => {
        if (hasNewMessagesBelowRef.current === value) return
        hasNewMessagesBelowRef.current = value
        setHasNewMessagesBelowState(value)
    }, [])

    const scrollToEnd = useCallback(
        ({ animated = false } = {}) => {
            // A smooth scroll delivers a scroll event per frame on the way down, and none of those
            // frames is at the bottom yet — so without this they would read as "the reader moved
            // away" and switch the pin off during the very scroll that was meant to arm it.
            if (animated) smoothScrollUntilRef.current = Date.now() + SMOOTH_SCROLL_MAX_MS
            scrollViewRef.current?.scrollToEnd({ animated })
        },
        [scrollViewRef]
    )

    /**
     * Re-arm and go. For actions that are an unambiguous "show me what happens next" — sending a
     * message above all, which must work from anywhere in the thread including after opening older
     * messages. `animated` is for the deliberate, user-initiated jumps (sending, the pill); the
     * automatic follow while an answer streams stays instant, because animating three to ten
     * scrolls a second would only smear the text the user is trying to read.
     */
    const pinToBottom = useCallback(
        ({ animated = false } = {}) => {
            stickToBottomRef.current = true
            setHasNewMessagesBelow(false)
            scrollToEnd({ animated })
        },
        [scrollToEnd, setHasNewMessagesBelow]
    )

    /**
     * Stand down without moving. For a deliberate jump away from the newest message whose content
     * arrives later ("show earlier"): without this, that arriving content would be pinned back to
     * the bottom before any scroll event could report where the reader actually went.
     */
    const releasePin = useCallback(() => {
        stickToBottomRef.current = false
    }, [])

    const handleScrollPosition = useCallback(
        ({ scrollY, contentHeight, viewportHeight }) => {
            contentHeightRef.current = contentHeight
            const previousScrollY = lastScrollYRef.current
            lastScrollYRef.current = scrollY

            if (resolveStickToBottom({ scrollY, contentHeight, viewportHeight })) {
                // Arrived. Anything reported after this is the reader again, so the grace ends here
                // rather than running out the clock.
                smoothScrollUntilRef.current = 0
                stickToBottomRef.current = true
                setHasNewMessagesBelow(false)
                return
            }

            if (Date.now() < smoothScrollUntilRef.current) {
                // Our own animation only ever moves DOWN toward the newest message, so a frame that
                // moved up is the reader taking over — browsers cancel a smooth scroll on wheel or
                // touch input. Hand control straight back instead of ignoring them for the rest of
                // the window, which would make scrolling away right after sending feel broken.
                if (scrollY >= previousScrollY) return
                smoothScrollUntilRef.current = 0
            }

            stickToBottomRef.current = false
        },
        [setHasNewMessagesBelow]
    )

    const handleContentSizeChange = useCallback(
        (contentWidth, contentHeight) => {
            const previousContentHeight = contentHeightRef.current
            contentHeightRef.current = contentHeight
            if (shouldPinToBottom({ stickToBottom: stickToBottomRef.current, contentHeight, previousContentHeight })) {
                scrollToEnd()
            }
        },
        [scrollToEnd]
    )

    const handleViewportLayout = useCallback(() => {
        if (stickToBottomRef.current) scrollToEnd()
    }, [scrollToEnd])

    useEffect(() => {
        if (!stickToBottomRef.current) {
            // Something arrived below the fold while the reader is up in the thread. Their position
            // is theirs to keep — offer the jump rather than taking it.
            setHasNewMessagesBelow(true)
            return undefined
        }
        const timeout = setTimeout(scrollToEnd)
        return () => clearTimeout(timeout)
    }, [newestMessageSignal, scrollToEnd, setHasNewMessagesBelow])

    return {
        handleScrollPosition,
        handleContentSizeChange,
        handleViewportLayout,
        pinToBottom,
        releasePin,
        hasNewMessagesBelow,
        isPinned: useCallback(() => stickToBottomRef.current, []),
    }
}
