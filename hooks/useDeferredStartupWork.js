import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import {
    DEFERRED_STARTUP_WORK_FALLBACK_MS,
    selectInitialTaskDataPublished,
    TASK_DATA_SETTLE_GRACE_MS,
} from '../utils/InitialLoad/startupTaskReadiness'

export { DEFERRED_STARTUP_WORK_FALLBACK_MS, selectInitialTaskDataPublished }

export const useInitialTaskDataPublished = () => useSelector(selectInitialTaskDataPublished)

export default function useDeferredStartupWork({
    enabled = true,
    fallbackMs = DEFERRED_STARTUP_WORK_FALLBACK_MS,
} = {}) {
    const taskDataPublished = useInitialTaskDataPublished()
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
        if (!enabled || taskDataPublished) return undefined

        const timer = setTimeout(() => setFallbackElapsed(true), fallbackMs)
        return () => clearTimeout(timer)
    }, [enabled, fallbackMs, taskDataPublished])

    return enabled && (taskDataSettled || fallbackElapsed)
}
