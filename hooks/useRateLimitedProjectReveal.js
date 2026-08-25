import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const PROJECT_REVEAL_MIN_INTERVAL_MS = 500
export const PROJECT_REVEAL_MAX_READY_WAIT_MS = 5000

/**
 * Reveal an automatically sorted project list without mounting every expensive
 * child in consecutive paints. Revealed project ids stay mounted even when a
 * first snapshot reorders the list; the next currently highest-ranked project
 * is admitted after the previous one is ready (or after the safety timeout).
 * Callers with long boards can additionally require the next placeholder to be
 * near the viewport, keeping offscreen listeners and rendering dormant.
 */
export default function useRateLimitedProjectReveal({
    projectIds,
    readyProjectIds,
    resetKey,
    minIntervalMs = PROJECT_REVEAL_MIN_INTERVAL_MS,
    maxReadyWaitMs = PROJECT_REVEAL_MAX_READY_WAIT_MS,
    requireNearViewport = false,
    now = Date.now,
}) {
    const membershipKey = useMemo(() => [...projectIds].sort().join('\u001f'), [projectIds])
    const revealKey = resetKey ?? membershipKey
    const initialProjectId = projectIds[0] || null
    const [revealState, setRevealState] = useState(() => ({
        key: revealKey,
        projectIds: initialProjectId ? [initialProjectId] : [],
    }))
    const [nearProject, setNearProject] = useState(null)
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
    const revealedProjectIdsSet = useMemo(() => new Set(revealedProjectIds), [revealedProjectIds])
    const nextProjectId = projectIds.find(projectId => !revealedProjectIdsSet.has(projectId)) || null

    useEffect(() => {
        if (revealState.key === revealKey) return
        lastRevealAtRef.current = now()
        setNearProject(null)
        setRevealState({
            key: revealKey,
            projectIds: initialProjectId ? [initialProjectId] : [],
        })
    }, [initialProjectId, now, revealKey, revealState.key])

    const previousProjectReady = !lastRevealedProjectId || readyProjectIds.includes(lastRevealedProjectId)

    const markProjectNearViewport = useCallback(
        projectId => {
            if (!requireNearViewport || projectId !== nextProjectId) return
            setNearProject(current => {
                if (current?.key === revealKey && current.projectId === projectId) return current
                return { key: revealKey, projectId }
            })
        },
        [nextProjectId, requireNearViewport, revealKey]
    )

    useEffect(() => {
        if (revealState.key !== revealKey || complete || !lastRevealedProjectId) return undefined
        if (
            requireNearViewport &&
            (!nearProject || nearProject.key !== revealKey || nearProject.projectId !== nextProjectId)
        ) {
            return undefined
        }

        const currentTime = now()
        const intervalRemaining = Math.max(0, lastRevealAtRef.current + minIntervalMs - currentTime)
        const readinessRemaining = previousProjectReady
            ? 0
            : Math.max(0, lastRevealAtRef.current + maxReadyWaitMs - currentTime)
        const delay = Math.max(intervalRemaining, readinessRemaining)

        const timer = setTimeout(() => {
            if (!nextProjectId) return

            lastRevealAtRef.current = now()
            setRevealState(current => {
                if (current.key !== revealKey || current.projectIds.includes(nextProjectId)) return current
                return { ...current, projectIds: [...current.projectIds, nextProjectId] }
            })
            setNearProject(current =>
                current?.key === revealKey && current.projectId === nextProjectId ? null : current
            )
        }, delay)

        return () => clearTimeout(timer)
    }, [
        complete,
        lastRevealedProjectId,
        maxReadyWaitMs,
        minIntervalMs,
        nearProject,
        nextProjectId,
        now,
        previousProjectReady,
        projectIds,
        readyProjectIds,
        requireNearViewport,
        revealKey,
        revealState.key,
    ])

    return { revealedProjectIds, primaryProjectId, complete, nextProjectId, markProjectNearViewport }
}
