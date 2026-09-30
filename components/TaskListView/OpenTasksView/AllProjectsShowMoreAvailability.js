import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'

import NeedShowMoreOpenTasksButton from './NeedShowMoreOpenTasksButton'

export const SHOW_MORE_CHECK_INITIAL_DELAY_MS = 750
export const SHOW_MORE_CHECK_STAGGER_MS = 150
export const SHOW_MORE_RECHECK_DEBOUNCE_MS = 2000

function DelayedAvailabilityCheck({ projectId, index, taskDataLoading }) {
    const [ready, setReady] = useState(false)
    const [checkGeneration, setCheckGeneration] = useState(0)
    // A task that leaves or enters today (postponed, completed, re-dated) changes this project's
    // today count for the board user, and is exactly when Later/Someday availability can change.
    // Re-run the one-shot check then instead of keeping live probes open for every project.
    const todayCount = useSelector(state => state.sidebarNumbers?.[projectId]?.[state.currentUser?.uid])
    const seenTodayCount = useRef(todayCount)

    useEffect(() => {
        // The count arriving for the first time is loading, not a change: keep it as the baseline.
        if (seenTodayCount.current === undefined) seenTodayCount.current = todayCount
        if (!ready || todayCount === seenTodayCount.current) return undefined
        const timer = setTimeout(() => {
            seenTodayCount.current = todayCount
            setCheckGeneration(generation => generation + 1)
        }, SHOW_MORE_RECHECK_DEBOUNCE_MS)
        return () => clearTimeout(timer)
    }, [ready, todayCount])

    useEffect(() => {
        if (ready || taskDataLoading) return undefined

        const timer = setTimeout(
            () => setReady(true),
            SHOW_MORE_CHECK_INITIAL_DELAY_MS + index * SHOW_MORE_CHECK_STAGGER_MS
        )
        return () => clearTimeout(timer)
    }, [index, ready, taskDataLoading])

    return ready ? (
        <NeedShowMoreOpenTasksButton projectId={projectId} live={false} refreshGeneration={checkGeneration} />
    ) : null
}

/**
 * The global show-more button still needs availability from every project,
 * including projects that have not reached the viewport. Run those checks once,
 * after visible task data is idle, and stagger them instead of arming another
 * permanent listener group for every project during the first render.
 */
export default function AllProjectsShowMoreAvailability({ projectIds }) {
    const taskDataLoading = useSelector(state => (state.isLoadingData || 0) > 0)

    return projectIds.map((projectId, index) => (
        <DelayedAvailabilityCheck
            key={projectId}
            projectId={projectId}
            index={index}
            taskDataLoading={taskDataLoading}
        />
    ))
}
