import { useCallback, useEffect, useMemo, useState } from 'react'

export const PROJECT_MOUNT_MIN_INTERVAL_MS = 500
export const PROJECT_MOUNT_MAX_READY_WAIT_MS = 5000

/**
 * Admit All Projects blocks one at a time. When the next placeholder reaches the
 * viewport, its project mounts immediately behind the ghost so its listeners can
 * start. The project becomes visible after its own two task streams are ready and
 * the short anti-flicker interval has elapsed. The timeout keeps an unavailable
 * project from blocking the rest of the board forever.
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

    const mountedProjectCount =
        queueState.projectKey === projectKey
            ? Math.min(queueState.mountedCount, projectIds.length)
            : initialMountedCount

    useEffect(() => {
        if (queueState.projectKey === projectKey) return

        setNearProject(null)
        setQueueState({ projectKey, mountedCount: initialMountedCount })
    }, [initialMountedCount, now, projectKey, queueState.projectKey])

    const markProjectNearViewport = useCallback(
        (projectIndex, isNearViewport = true) => {
            if (projectIndex !== mountedProjectCount || projectIndex >= projectIds.length) return

            setNearProject(current => {
                if (!isNearViewport) {
                    // Once this single prefetch has started, keep it alive even
                    // if layout movement pushes the ghost out of the viewport.
                    return current
                }
                if (current?.projectKey === projectKey && current.projectIndex === projectIndex) return current
                return { projectKey, projectIndex, sinceAt: now() }
            })
        },
        [mountedProjectCount, now, projectIds.length, projectKey]
    )

    const preloadingProjectIndex =
        nearProject?.projectKey === projectKey && nearProject.projectIndex === mountedProjectCount
            ? mountedProjectCount
            : null
    const preloadingProjectReady =
        preloadingProjectIndex !== null && projectReadyStates[preloadingProjectIndex] === true

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
        // Start the visible interval when the placeholder actually reaches the
        // viewport. Measuring from the previous mount lets a long scroll consume
        // the whole delay before the user can see the loading ghost.
        const intervalRemaining = Math.max(0, nearProject.sinceAt + minIntervalMs - currentTime)
        const readinessRemaining = preloadingProjectReady
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
        preloadingProjectReady,
        projectIds.length,
        projectKey,
    ])

    return {
        mountedProjectCount,
        preloadingProjectIndex,
        nextProjectIndex: mountedProjectCount < projectIds.length ? mountedProjectCount : null,
        markProjectNearViewport,
    }
}
