import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import {
    DEFERRED_STARTUP_WORK_FALLBACK_MS,
    selectInitialTaskDataPublished,
} from '../utils/InitialLoad/startupTaskReadiness'

export { DEFERRED_STARTUP_WORK_FALLBACK_MS, selectInitialTaskDataPublished }

export const useInitialTaskDataPublished = () => useSelector(selectInitialTaskDataPublished)

export default function useDeferredStartupWork({
    enabled = true,
    fallbackMs = DEFERRED_STARTUP_WORK_FALLBACK_MS,
} = {}) {
    const taskDataPublished = useInitialTaskDataPublished()
    const [fallbackElapsed, setFallbackElapsed] = useState(false)

    useEffect(() => {
        setFallbackElapsed(false)
        if (!enabled || taskDataPublished) return undefined

        const timer = setTimeout(() => setFallbackElapsed(true), fallbackMs)
        return () => clearTimeout(timer)
    }, [enabled, fallbackMs, taskDataPublished])

    return enabled && (taskDataPublished || fallbackElapsed)
}
