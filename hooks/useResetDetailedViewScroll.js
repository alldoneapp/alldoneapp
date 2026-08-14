import { useLayoutEffect } from 'react'

import { resetDetailedViewScroll } from '../utils/scrollUtils'

export default function useResetDetailedViewScroll(resetKey, scrollRef) {
    useLayoutEffect(() => {
        resetDetailedViewScroll(scrollRef)
        const delayedReset = setTimeout(() => resetDetailedViewScroll(scrollRef))

        return () => clearTimeout(delayedReset)
    }, [resetKey, scrollRef])
}
