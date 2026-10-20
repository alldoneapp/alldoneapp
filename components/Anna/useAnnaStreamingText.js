import { useLayoutEffect, useRef, useState } from 'react'

// Keep the complete source for editing/copying and reveal only the read-only view.
// Existing history is immediate; only append-only updates to a live answer are paced.
export default function useAnnaStreamingText(text, enabled, reducedMotion = false) {
    const [displayed, setDisplayed] = useState(text)
    const shown = useRef(text)
    const previous = useRef(text)
    useLayoutEffect(() => {
        const was = previous.current
        previous.current = text
        const publish = value => {
            shown.current = value
            setDisplayed(value)
        }
        if (!enabled || reducedMotion || !text.startsWith(was) || !text.startsWith(shown.current)) {
            publish(text)
            return
        }
        if (shown.current === text) return
        let frame
        let start
        const from = shown.current.length
        let lastPaint = 0
        const tick = time => {
            if (start === undefined) start = time
            // At most 180ms behind each snapshot, independent of response length.
            // 30fps bounds markdown parsing work without a per-character timer/tree.
            const progress = Math.min(1, (time - start + 32) / 180)
            if (time - lastPaint >= 32 || progress === 1) {
                let end = from + Math.ceil((text.length - from) * progress)
                // Never expose half a UTF-16 surrogate (emoji).
                if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end++
                publish(text.slice(0, end))
                lastPaint = time
            }
            if (progress < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [text, enabled, reducedMotion])
    // Replacements and completed/history messages must never show stale partial content.
    return !enabled || reducedMotion || !text.startsWith(displayed) ? text : displayed
}
