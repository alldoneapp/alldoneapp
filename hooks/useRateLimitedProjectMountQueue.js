import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const PROJECT_MOUNT_MIN_INTERVAL_MS = 500
export const PROJECT_MOUNT_MAX_READY_WAIT_MS = 5000

/**
 * Admit All Projects blocks one at a time. A newly visible placeholder may only
 * mount after the previous project's two task streams delivered their initial
 * snapshots. The timeout keeps an unavailable project from blocking the rest
 * of the board forever.
 */
export default function useRateLimitedProjectMountQueue({
    projectIds,
    projectReadyStates,
    minIntervalMs = PROJECT_MOUNT_MIN_INTERVAL_MS,
    maxReadyWaitMs = PROJECT_MOUNT_MAX_READY_WAIT_MS,
    now = Date.now,
}) {
    const projectKey = useMemo(() => projectIds.join('\u001f'), [projectIds])
    const initialMountedCount = projectIds.length > 0 ? 1 : 0
    const [queueState, setQueueState] = useState(() => ({
        projectKey,
        mountedCount: initialMountedCount,
    }))
    const [nearProject, setNearProject] = useState(null)
    const lastMountAtRef = useRef(now())

    const mountedProjectCount =
        queueState.projectKey === projectKey
            ? Math.min(queueState.mountedCount, projectIds.length)
            : initialMountedCount

    useEffect(() => {
        if (queueState.projectKey === projectKey) return

        lastMountAtRef.current = now()
        setNearProject(null)
        setQueueState({ projectKey, mountedCount: initialMountedCount })
    }, [initialMountedCount, now, projectKey, queueState.projectKey])

    const markProjectNearViewport = useCallback(
        projectIndex => {
            if (projectIndex !== mountedProjectCount || projectIndex >= projectIds.length) return

            setNearProject(current => {
                if (current?.projectKey === projectKey && current.projectIndex === projectIndex) return current
                return { projectKey, projectIndex, sinceAt: now() }
            })
        },
        [mountedProjectCount, now, projectIds.length, projectKey]
    )

    const previousProjectReady = mountedProjectCount === 0 || projectReadyStates[mountedProjectCount - 1] === true

    useEffect(() => {
        if (
            !nearProject ||
            nearProject.projectKey !== projectKey ||
            nearProject.projectIndex !== mountedProjectCount ||
            mountedProjectCount >= projectIds.length
        ) {
            return undefined
        }

        const currentTime = now()
        const intervalRemaining = Math.max(0, lastMountAtRef.current + minIntervalMs - currentTime)
        const readinessRemaining = previousProjectReady
            ? 0
            : Math.max(0, nearProject.sinceAt + maxReadyWaitMs - currentTime)
        const delay = Math.max(intervalRemaining, readinessRemaining)

        const timer = setTimeout(() => {
            setQueueState(current => {
                if (current.projectKey !== projectKey || current.mountedCount !== mountedProjectCount) return current
                return {
                    projectKey,
                    mountedCount: Math.min(projectIds.length, mountedProjectCount + 1),
                }
            })
            lastMountAtRef.current = now()
            setNearProject(current =>
                current?.projectKey === projectKey && current.projectIndex === mountedProjectCount ? null : current
            )
        }, delay)

        return () => clearTimeout(timer)
    }, [
        maxReadyWaitMs,
        minIntervalMs,
        mountedProjectCount,
        nearProject,
        now,
        previousProjectReady,
        projectIds.length,
        projectKey,
    ])

    return {
        mountedProjectCount,
        nextProjectIndex: mountedProjectCount < projectIds.length ? mountedProjectCount : null,
        markProjectNearViewport,
    }
}
