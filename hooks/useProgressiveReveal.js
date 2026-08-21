import { useEffect, useState } from 'react'

import { scheduleAfterPaint } from './usePagedReveal'

// requestAnimationFrame is paused in a background tab. Keep a timer backstop so the
// remaining task projects still mount if the tab is hidden while the board is opening.
export const PROGRESSIVE_REVEAL_TIMEOUT_MS = 1000

/**
 * Automatically reveals an already-known list in small, post-paint batches.
 *
 * The initial batch is part of the tab-switch commit. Every later batch is scheduled
 * after a paint, which prevents a large list of expensive children from turning one
 * click handler into one multi-second synchronous render.
 */
export default function useProgressiveReveal(totalCount, options = {}) {
    const {
        batchSize = 1,
        initialAmount = batchSize,
        resetKey = totalCount,
        schedule = scheduleAfterPaint,
        timeoutMs = PROGRESSIVE_REVEAL_TIMEOUT_MS,
    } = options

    const safeTotalCount = Math.max(0, totalCount)
    const safeBatchSize = Math.max(1, batchSize)
    const safeInitialAmount = Math.min(safeTotalCount, Math.max(0, initialAmount))
    const [revealState, setRevealState] = useState(() => ({
        key: resetKey,
        visibleAmount: safeInitialAmount,
    }))

    // A new list must start small even in the render before the reset effect commits.
    const visibleAmount =
        revealState.key === resetKey ? Math.min(safeTotalCount, revealState.visibleAmount) : safeInitialAmount
    const complete = visibleAmount >= safeTotalCount

    useEffect(() => {
        if (revealState.key !== resetKey) {
            setRevealState({ key: resetKey, visibleAmount: safeInitialAmount })
            return undefined
        }

        if (complete) return undefined

        const revealNextBatch = () => {
            setRevealState(current => {
                if (current.key !== resetKey) return current
                return {
                    ...current,
                    visibleAmount: Math.min(safeTotalCount, current.visibleAmount + safeBatchSize),
                }
            })
        }
        const cancelSchedule = schedule(revealNextBatch)
        const timer = setTimeout(revealNextBatch, timeoutMs)

        return () => {
            if (typeof cancelSchedule === 'function') cancelSchedule()
            clearTimeout(timer)
        }
    }, [
        complete,
        resetKey,
        revealState.key,
        safeBatchSize,
        safeInitialAmount,
        safeTotalCount,
        schedule,
        timeoutMs,
        visibleAmount,
    ])

    return { visibleAmount, complete }
}
