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
    activateWhenPassed = false,
} = {}) {
    const placeholderRef = useRef(null)
    const [isNearViewport, setIsNearViewport] = useState(eager)
    const [hasPassedViewport, setHasPassedViewport] = useState(false)

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

        let passedViewport = false
        const activatePassedTarget = entry => {
            if (!activateWhenPassed || passedViewport) return false

            const bounds = entry?.boundingClientRect ?? target.getBoundingClientRect?.()
            const viewportTop = entry?.rootBounds?.top ?? 0
            if (!bounds || bounds.bottom > viewportTop) return false

            passedViewport = true
            setHasPassedViewport(true)
            setIsNearViewport(true)
            return true
        }

        const observer = new IntersectionObserver(
            entries => {
                const nextIsNearViewport = entries.some(entry => entry.isIntersecting)
                const passed = entries.some(entry => activatePassedTarget(entry))
                if (trackVisibility) {
                    setIsNearViewport(nextIsNearViewport || passed || passedViewport)
                } else if (nextIsNearViewport || passed) {
                    setIsNearViewport(true)
                    observer.disconnect()
                }
            },
            { rootMargin }
        )
        observer.observe(target)

        // IntersectionObserver can miss a very fast fling when a target moves
        // from below the viewport to above it between samples: both positions
        // have an intersection ratio of zero. Listen only while this one central
        // queue sentinel is active and recover as soon as it has been passed.
        const handleScroll = () => activatePassedTarget()
        if (activateWhenPassed && typeof window !== 'undefined') {
            window.addEventListener('scroll', handleScroll, true)
            activatePassedTarget()
        }

        return () => {
            observer.disconnect()
            if (activateWhenPassed && typeof window !== 'undefined') {
                window.removeEventListener('scroll', handleScroll, true)
            }
        }
    }, [activateWhenPassed, enabled, isNearViewport, rootMargin, trackVisibility])

    return { placeholderRef, isNearViewport, hasPassedViewport, shouldMount: eager || isNearViewport }
}
