import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const PROJECT_REVEAL_MIN_INTERVAL_MS = 500
export const PROJECT_REVEAL_MAX_READY_WAIT_MS = 5000

/**
 * Reveal an automatically sorted project list without mounting every expensive
 * child in consecutive paints. Revealed project ids stay mounted even when a
 * first snapshot reorders the list. Regular callers admit the next project after
 * the previous one is ready. Viewport-gated callers preload the next project
 * behind its ghost, then reveal it after its own first snapshot. The timeout
 * keeps an unavailable project from blocking the rest of the board forever.
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
        (projectId, isNearViewport = true) => {
            if (!requireNearViewport || projectId !== nextProjectId) return
            setNearProject(current => {
                if (!isNearViewport) {
                    // The viewport-gated caller has already started this one
                    // prefetch. Keep it alive while the ghost is replaced.
                    return current
                }
                if (current?.key === revealKey && current.projectId === projectId) return current
                return { key: revealKey, projectId, sinceAt: now() }
            })
        },
        [nextProjectId, now, requireNearViewport, revealKey]
    )

    const loadingProjectId =
        requireNearViewport && nearProject?.key === revealKey && nearProject.projectId === nextProjectId
            ? nextProjectId
            : null
    const loadingProjectReady = !!loadingProjectId && readyProjectIds.includes(loadingProjectId)

    useEffect(() => {
        if (revealState.key !== revealKey || complete || !lastRevealedProjectId) return undefined
        if (
            requireNearViewport &&
            (!nearProject || nearProject.key !== revealKey || nearProject.projectId !== nextProjectId)
        ) {
            return undefined
        }

        const currentTime = now()
        const intervalStartedAt = requireNearViewport ? nearProject.sinceAt : lastRevealAtRef.current
        const intervalRemaining = Math.max(0, intervalStartedAt + minIntervalMs - currentTime)
        const projectReady = requireNearViewport ? loadingProjectReady : previousProjectReady
        const readyWaitStartedAt = requireNearViewport ? nearProject.sinceAt : lastRevealAtRef.current
        const readinessRemaining = projectReady ? 0 : Math.max(0, readyWaitStartedAt + maxReadyWaitMs - currentTime)
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
        loadingProjectReady,
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

    return {
        revealedProjectIds,
        primaryProjectId,
        complete,
        nextProjectId,
        loadingProjectId,
        markProjectNearViewport,
    }
}
