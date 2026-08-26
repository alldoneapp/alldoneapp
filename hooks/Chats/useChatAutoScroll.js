import { useCallback, useEffect, useRef } from 'react'

import { resolveStickToBottom, shouldPinToBottom } from '../../components/ChatsView/Utils/chatAutoScroll'

/**
 * Keeps a chat scroller parked on the newest message (AT-2439).
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
 * read only by those three sites, so keeping it out of the render cycle avoids re-rendering the
 * whole message list while the user drags.
 */
export default function useChatAutoScroll({ scrollViewRef, newestMessageSignal }) {
    // Starts pinned: opening a chat puts you on the newest message.
    const stickToBottomRef = useRef(true)
    const contentHeightRef = useRef(0)

    const scrollToEnd = useCallback(() => {
        scrollViewRef.current?.scrollToEnd({ animated: false })
    }, [scrollViewRef])

    /**
     * Re-arm and go. For actions that are an unambiguous "show me what happens next" — sending a
     * message above all, which must work from anywhere in the thread including after opening older
     * messages.
     */
    const pinToBottom = useCallback(() => {
        stickToBottomRef.current = true
        scrollToEnd()
    }, [scrollToEnd])

    /**
     * Stand down without moving. For a deliberate jump away from the newest message whose content
     * arrives later ("show earlier"): without this, that arriving content would be pinned back to
     * the bottom before any scroll event could report where the reader actually went.
     */
    const releasePin = useCallback(() => {
        stickToBottomRef.current = false
    }, [])

    const handleScrollPosition = useCallback(({ scrollY, contentHeight, viewportHeight }) => {
        contentHeightRef.current = contentHeight
        stickToBottomRef.current = resolveStickToBottom({ scrollY, contentHeight, viewportHeight })
    }, [])

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
        if (!stickToBottomRef.current) return undefined
        const timeout = setTimeout(scrollToEnd)
        return () => clearTimeout(timeout)
    }, [newestMessageSignal, scrollToEnd])

    return {
        handleScrollPosition,
        handleContentSizeChange,
        handleViewportLayout,
        pinToBottom,
        releasePin,
        isPinned: useCallback(() => stickToBottomRef.current, []),
    }
}
