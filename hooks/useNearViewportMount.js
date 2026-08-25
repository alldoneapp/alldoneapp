import { useEffect, useRef, useState } from 'react'

export const NEAR_VIEWPORT_ROOT_MARGIN = '600px 0px'

/**
 * Keep expensive all-project blocks dormant until scrolling brings them close
 * to the viewport. Native builds do not expose IntersectionObserver, so they
 * retain the previous eager behavior.
 */
export default function useNearViewportMount({ eager = false, rootMargin = NEAR_VIEWPORT_ROOT_MARGIN } = {}) {
    const placeholderRef = useRef(null)
    const [shouldMount, setShouldMount] = useState(eager)

    useEffect(() => {
        if (shouldMount) return undefined
        if (typeof IntersectionObserver === 'undefined') {
            setShouldMount(true)
            return undefined
        }

        const target = placeholderRef.current
        if (!target) {
            setShouldMount(true)
            return undefined
        }

        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) {
                    setShouldMount(true)
                    observer.disconnect()
                }
            },
            { rootMargin }
        )
        observer.observe(target)

        return () => observer.disconnect()
    }, [rootMargin, shouldMount])

    return { placeholderRef, shouldMount }
}
