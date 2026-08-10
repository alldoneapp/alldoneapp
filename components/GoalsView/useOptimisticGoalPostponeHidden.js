import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { clearOptimisticGoalPostpone } from '../../redux/actions'
import {
    getOptimisticGoalPostponeKey,
    isOptimisticGoalPostponePending,
    OPTIMISTIC_GOAL_POSTPONE_TTL_MS,
} from '../../utils/backends/Goals/optimisticGoalPostpone'

/**
 * AT-2160: true while this goal has a postpone in flight, so the caller can drop it from the
 * list immediately instead of waiting for the server round trip. See optimisticGoalPostpone.js
 * for why the entry is only ever cleared on failure or by the TTL.
 *
 * The TTL alone would not bring the row back: nothing re-renders when a timestamp merely gets
 * old. The timer below exists solely to force that re-render at the moment the entry expires.
 */
export default function useOptimisticGoalPostponeHidden(projectId, goalId) {
    const dispatch = useDispatch()
    const entry = useSelector(state => state.optimisticGoalPostpones[getOptimisticGoalPostponeKey(projectId, goalId)])
    const [, setExpiryTick] = useState(0)

    const startedAt = entry?.startedAt
    const hidden = isOptimisticGoalPostponePending(entry)

    useEffect(() => {
        if (!hidden) return undefined
        const remaining = Math.max(0, startedAt + OPTIMISTIC_GOAL_POSTPONE_TTL_MS - Date.now())
        const timeoutId = setTimeout(() => {
            // Drop the dead entry and re-render, so a postpone that never came back does not
            // leave the goal invisible.
            dispatch(clearOptimisticGoalPostpone(projectId, goalId))
            setExpiryTick(tick => tick + 1)
        }, remaining)
        return () => clearTimeout(timeoutId)
    }, [hidden, startedAt, projectId, goalId, dispatch])

    return hidden
}
