import { useEffect, useRef, useState } from 'react'

import { RESUME_INTEGRITY_MS, subscribePageVisible } from '../utils/appResume'

// Firestore normally resumes its listeners without help. After a longer browser suspension,
// however, Android can thaw the page while the old Listen stream is still retrying in the
// background. Re-subscribing after this gap asks for an authoritative snapshot immediately while
// callers keep their already-rendered data on screen.
export const PAGE_VISIBLE_REFRESH_AFTER_MS = RESUME_INTEGRITY_MS

export default function usePageVisibleRefreshGeneration({
    enabled = true,
    refreshAfterMs = PAGE_VISIBLE_REFRESH_AFTER_MS,
} = {}) {
    const [generation, setGeneration] = useState(0)
    const lastVisibleAtRef = useRef(Date.now())

    useEffect(() => {
        lastVisibleAtRef.current = Date.now()

        return subscribePageVisible(({ hiddenMs } = {}) => {
            const visibleAt = Date.now()
            const elapsedSinceLastVisible = visibleAt - lastVisibleAtRef.current
            lastVisibleAtRef.current = visibleAt
            const absenceMs = Number.isFinite(hiddenMs) ? hiddenMs : elapsedSinceLastVisible

            if (!enabled || absenceMs < refreshAfterMs) return
            setGeneration(currentGeneration => currentGeneration + 1)
        })
    }, [enabled, refreshAfterMs])

    return generation
}
