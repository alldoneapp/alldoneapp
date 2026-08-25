import React, { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'

import NeedShowMoreOpenTasksButton from './NeedShowMoreOpenTasksButton'

export const SHOW_MORE_CHECK_INITIAL_DELAY_MS = 750
export const SHOW_MORE_CHECK_STAGGER_MS = 150

function DelayedAvailabilityCheck({ projectId, index, taskDataLoading }) {
    const [ready, setReady] = useState(false)

    useEffect(() => {
        if (ready || taskDataLoading) return undefined

        const timer = setTimeout(
            () => setReady(true),
            SHOW_MORE_CHECK_INITIAL_DELAY_MS + index * SHOW_MORE_CHECK_STAGGER_MS
        )
        return () => clearTimeout(timer)
    }, [index, ready, taskDataLoading])

    return ready ? <NeedShowMoreOpenTasksButton projectId={projectId} live={false} /> : null
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
