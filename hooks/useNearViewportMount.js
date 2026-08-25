import { useEffect, useRef, useState } from 'react'

export const NEAR_VIEWPORT_ROOT_MARGIN = '600px 0px'

/**
 * Report when an expensive block is close to the viewport. Admission is kept
 * separate so a group of collapsing placeholders cannot all mount at once.
 */
export default function useNearViewportMount({
    eager = false,
    enabled = true,
    rootMargin = NEAR_VIEWPORT_ROOT_MARGIN,
    trackVisibility = false,
} = {}) {
    const placeholderRef = useRef(null)
    const [isNearViewport, setIsNearViewport] = useState(eager)

    useEffect(() => {
        if (!enabled || (!trackVisibility && isNearViewport)) return undefined
        if (typeof IntersectionObserver === 'undefined') {
            setIsNearViewport(true)
            return undefined
        }

        const target = placeholderRef.current
        if (!target) {
            setIsNearViewport(true)
            return undefined
        }

        const observer = new IntersectionObserver(
            entries => {
                const nextIsNearViewport = entries.some(entry => entry.isIntersecting)
                if (trackVisibility) {
                    setIsNearViewport(nextIsNearViewport)
                } else if (nextIsNearViewport) {
                    setIsNearViewport(nextIsNearViewport)
                    observer.disconnect()
                }
            },
            { rootMargin }
        )
        observer.observe(target)

        return () => observer.disconnect()
    }, [enabled, isNearViewport, rootMargin, trackVisibility])

    return { placeholderRef, isNearViewport, shouldMount: eager || isNearViewport }
}
