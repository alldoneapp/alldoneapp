import { useEffect, useMemo, useRef, useState } from 'react'

export const PROJECT_REVEAL_MIN_INTERVAL_MS = 500
export const PROJECT_REVEAL_MAX_READY_WAIT_MS = 5000

/**
 * Reveal an automatically sorted project list without mounting every expensive
 * child in consecutive paints. Revealed project ids stay mounted even when a
 * first snapshot reorders the list; the next currently highest-ranked project
 * is admitted after the previous one is ready (or after the safety timeout).
 */
export default function useRateLimitedProjectReveal({
    projectIds,
    readyProjectIds,
    resetKey,
    minIntervalMs = PROJECT_REVEAL_MIN_INTERVAL_MS,
    maxReadyWaitMs = PROJECT_REVEAL_MAX_READY_WAIT_MS,
    now = Date.now,
}) {
    const membershipKey = useMemo(() => [...projectIds].sort().join('\u001f'), [projectIds])
    const revealKey = resetKey ?? membershipKey
    const initialProjectId = projectIds[0] || null
    const [revealState, setRevealState] = useState(() => ({
        key: revealKey,
        projectIds: initialProjectId ? [initialProjectId] : [],
    }))
    const lastRevealAtRef = useRef(now())

    const currentMembership = useMemo(() => new Set(projectIds), [membershipKey, projectIds])
    const revealedProjectIds = useMemo(
        () =>
            revealState.key === revealKey
                ? revealState.projectIds.filter(projectId => currentMembership.has(projectId))
                : initialProjectId
                  ? [initialProjectId]
                  : [],
        [currentMembership, initialProjectId, revealKey, revealState]
    )
    const primaryProjectId = revealedProjectIds[0] || null
    const lastRevealedProjectId = revealedProjectIds[revealedProjectIds.length - 1] || null
    const complete = revealedProjectIds.length >= projectIds.length

    useEffect(() => {
        if (revealState.key === revealKey) return
        lastRevealAtRef.current = now()
        setRevealState({
            key: revealKey,
            projectIds: initialProjectId ? [initialProjectId] : [],
        })
    }, [initialProjectId, now, revealKey, revealState.key])

    const previousProjectReady = !lastRevealedProjectId || readyProjectIds.includes(lastRevealedProjectId)

    useEffect(() => {
        if (revealState.key !== revealKey || complete || !lastRevealedProjectId) return undefined

        const currentTime = now()
        const intervalRemaining = Math.max(0, lastRevealAtRef.current + minIntervalMs - currentTime)
        const readinessRemaining = previousProjectReady
            ? 0
            : Math.max(0, lastRevealAtRef.current + maxReadyWaitMs - currentTime)
        const delay = Math.max(intervalRemaining, readinessRemaining)

        const timer = setTimeout(() => {
            const revealedSet = new Set(revealedProjectIds)
            const nextProjectId = projectIds.find(projectId => !revealedSet.has(projectId))
            if (!nextProjectId) return

            lastRevealAtRef.current = now()
            setRevealState(current => {
                if (current.key !== revealKey || current.projectIds.includes(nextProjectId)) return current
                return { ...current, projectIds: [...current.projectIds, nextProjectId] }
            })
        }, delay)

        return () => clearTimeout(timer)
    }, [
        complete,
        lastRevealedProjectId,
        maxReadyWaitMs,
        minIntervalMs,
        now,
        previousProjectReady,
        projectIds,
        readyProjectIds,
        revealKey,
        revealedProjectIds,
        revealState.key,
    ])

    return { revealedProjectIds, primaryProjectId, complete }
}
