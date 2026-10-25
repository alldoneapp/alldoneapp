import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import {
    DEFERRED_STARTUP_WORK_FALLBACK_MS,
    selectInitialTaskDataPublished,
    TASK_DATA_SETTLE_GRACE_MS,
} from '../utils/InitialLoad/startupTaskReadiness'
import { DV_TAB_ROOT_TASKS } from '../utils/TabNavigationConstants'

export { DEFERRED_STARTUP_WORK_FALLBACK_MS, selectInitialTaskDataPublished }

export const useInitialTaskDataPublished = () => useSelector(selectInitialTaskDataPublished)

// The fallback exists for routes that never mount a task board. On the task board itself it used
// to release all deferred listeners after twelve seconds even when the foreground task queries
// were still working. That background fan-out then competed with exactly the data the user was
// waiting to see. A task board releases background work only from real task readiness instead.
export const selectDeferredStartupFallbackAllowed = state => state.route !== DV_TAB_ROOT_TASKS

export default function useDeferredStartupWork({
    enabled = true,
    fallbackMs = DEFERRED_STARTUP_WORK_FALLBACK_MS,
} = {}) {
    const taskDataPublished = useInitialTaskDataPublished()
    const fallbackAllowed = useSelector(selectDeferredStartupFallbackAllowed)
    const [fallbackElapsed, setFallbackElapsed] = useState(false)
    const [taskDataSettled, setTaskDataSettled] = useState(false)

    useEffect(() => {
        setTaskDataSettled(false)
        if (!enabled || !taskDataPublished) return undefined

        const timer = setTimeout(() => setTaskDataSettled(true), TASK_DATA_SETTLE_GRACE_MS)
        return () => clearTimeout(timer)
    }, [enabled, taskDataPublished])

    useEffect(() => {
        setFallbackElapsed(false)
        if (!enabled || taskDataPublished || !fallbackAllowed) return undefined

        const timer = setTimeout(() => setFallbackElapsed(true), fallbackMs)
        return () => clearTimeout(timer)
    }, [enabled, fallbackAllowed, fallbackMs, taskDataPublished])

    return enabled && (taskDataSettled || (fallbackAllowed && fallbackElapsed))
}
