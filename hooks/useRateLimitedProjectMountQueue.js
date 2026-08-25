import { useCallback, useEffect, useMemo, useState } from 'react'

export const PROJECT_MOUNT_MIN_INTERVAL_MS = 500
export const PROJECT_MOUNT_MAX_READY_WAIT_MS = 5000
export const PROJECT_FAST_FLING_CONCURRENCY = 3

const uniqueIndexes = indexes => [...new Set(indexes)]

const normalizeConcurrency = (value, fallback) => {
    if (!Number.isFinite(value)) return fallback
    return Math.max(1, Math.floor(value))
}

/**
 * Keep normal scrolling bounded while allowing a fast fling to prioritize the
 * projects actually under the viewport. Normal batches preload sequentially and
 * reveal in order. A skipped sentinel can replace that batch with up to two
 * viewport projects plus the earliest missing project for background backfill.
 * The total number of live preloads therefore stays capped at three.
 */
export default function useRateLimitedProjectMountQueue({
    projectIds,
    projectReadyStates,
    minIntervalMs = PROJECT_MOUNT_MIN_INTERVAL_MS,
    maxReadyWaitMs = PROJECT_MOUNT_MAX_READY_WAIT_MS,
    preloadConcurrency = 1,
    fastFlingConcurrency = PROJECT_FAST_FLING_CONCURRENCY,
    now = Date.now,
}) {
    const projectKey = useMemo(() => projectIds.join('\u001f'), [projectIds])
    const initialMountedIndexes = useMemo(() => (projectIds.length > 0 ? [0] : []), [projectIds.length])
    const [queueState, setQueueState] = useState(() => ({
        projectKey,
        mountedIndexes: initialMountedIndexes,
    }))
    const [preloadEntries, setPreloadEntries] = useState([])

    const mountedProjectIndexes = useMemo(
        () =>
            queueState.projectKey === projectKey
                ? queueState.mountedIndexes.filter(index => index < projectIds.length)
                : initialMountedIndexes,
        [initialMountedIndexes, projectIds.length, projectKey, queueState]
    )
    const mountedProjectIndexesSet = useMemo(() => new Set(mountedProjectIndexes), [mountedProjectIndexes])
    let mountedProjectCount = 0
    while (mountedProjectIndexesSet.has(mountedProjectCount)) mountedProjectCount += 1

    const activePreloadEntries = useMemo(
        () =>
            preloadEntries.filter(
                entry =>
                    entry.projectKey === projectKey &&
                    entry.index < projectIds.length &&
                    !mountedProjectIndexesSet.has(entry.index)
            ),
        [mountedProjectIndexesSet, preloadEntries, projectIds.length, projectKey]
    )
    const preloadingProjectIndexes = useMemo(
        () => activePreloadEntries.map(entry => entry.index),
        [activePreloadEntries]
    )
    const preloadingProjectIndex = preloadingProjectIndexes[0] ?? null
    const preloadingProjectSkipped = activePreloadEntries.some(entry => entry.showSkippedProjectGhost)
    const nextProjectIndex = mountedProjectCount < projectIds.length ? mountedProjectCount : null

    useEffect(() => {
        if (queueState.projectKey === projectKey) return

        setPreloadEntries([])
        setQueueState({ projectKey, mountedIndexes: initialMountedIndexes })
    }, [initialMountedIndexes, projectKey, queueState.projectKey])

    const markProjectNearViewport = useCallback(
        (
            projectIndex,
            isNearViewport = true,
            hasPassedViewport = false,
            viewportProjectIndexes = [],
            hasVisibleProject = false
        ) => {
            if (projectIndex !== mountedProjectCount || projectIndex >= projectIds.length) return
            if (!isNearViewport && !hasPassedViewport) return

            const normalLimit = normalizeConcurrency(preloadConcurrency, 1)
            const fastLimit = normalizeConcurrency(fastFlingConcurrency, PROJECT_FAST_FLING_CONCURRENCY)
            const sequentialIndexes = Array.from(
                { length: normalLimit },
                (_, offset) => mountedProjectCount + offset
            ).filter(index => index < projectIds.length && !mountedProjectIndexesSet.has(index))
            const viewportIndexes = hasPassedViewport
                ? uniqueIndexes(viewportProjectIndexes)
                      .filter(index => index >= 0 && index < projectIds.length)
                      .filter(index => !mountedProjectIndexesSet.has(index))
                      .slice(0, Math.max(1, fastLimit - 1))
                : []
            const backgroundIndexes = hasVisibleProject ? sequentialIndexes.slice(0, 1) : sequentialIndexes
            const desiredIndexes = hasPassedViewport
                ? uniqueIndexes([...viewportIndexes, ...backgroundIndexes]).slice(0, fastLimit)
                : sequentialIndexes
            const viewportIndexSet = new Set(viewportIndexes)
            const showFallbackGhost = hasPassedViewport && viewportIndexes.length === 0 && !hasVisibleProject
            const startedAt = now()

            setPreloadEntries(current => {
                const currentByIndex = new Map(
                    current.filter(entry => entry.projectKey === projectKey).map(entry => [entry.index, entry])
                )

                return desiredIndexes.map((index, rank) => {
                    const existing = currentByIndex.get(index)
                    return {
                        projectKey,
                        index,
                        startedAt: existing?.startedAt ?? startedAt,
                        allowOutOfOrder: viewportIndexSet.has(index),
                        showSkippedProjectGhost: showFallbackGhost,
                        priorityRank: viewportIndexSet.has(index) ? rank : fastLimit + index,
                    }
                })
            })
        },
        [
            fastFlingConcurrency,
            mountedProjectCount,
            mountedProjectIndexesSet,
            now,
            preloadConcurrency,
            projectIds.length,
            projectKey,
        ]
    )

    useEffect(() => {
        const hasViewportPriority = activePreloadEntries.some(entry => entry.allowOutOfOrder)
        const admissibleEntries = activePreloadEntries.filter(
            entry => entry.allowOutOfOrder || (!hasViewportPriority && entry.index === mountedProjectCount)
        )
        if (admissibleEntries.length === 0) return undefined

        const currentTime = now()
        const scheduledEntries = admissibleEntries
            .map(entry => {
                const ready = projectReadyStates[entry.index] === true
                const readyAt = ready
                    ? entry.startedAt + minIntervalMs
                    : entry.startedAt + Math.max(minIntervalMs, maxReadyWaitMs)
                return { entry, readyAt }
            })
            .sort(
                (first, second) =>
                    first.readyAt - second.readyAt ||
                    first.entry.priorityRank - second.entry.priorityRank ||
                    first.entry.index - second.entry.index
            )
        const nextEntry = scheduledEntries[0]
        const delay = Math.max(0, nextEntry.readyAt - currentTime)

        const timer = setTimeout(() => {
            const admittedIndex = nextEntry.entry.index
            setQueueState(current => {
                if (current.projectKey !== projectKey || current.mountedIndexes.includes(admittedIndex)) {
                    return current
                }
                return {
                    projectKey,
                    mountedIndexes: [...current.mountedIndexes, admittedIndex].sort((a, b) => a - b),
                }
            })
            setPreloadEntries(current =>
                current.filter(entry => entry.projectKey !== projectKey || entry.index !== admittedIndex)
            )
        }, delay)

        return () => clearTimeout(timer)
    }, [activePreloadEntries, maxReadyWaitMs, minIntervalMs, mountedProjectCount, now, projectReadyStates, projectKey])

    return {
        mountedProjectCount,
        mountedProjectIndexes,
        preloadingProjectIndex,
        preloadingProjectIndexes,
        preloadingProjectSkipped,
        nextProjectIndex,
        markProjectNearViewport,
    }
}
