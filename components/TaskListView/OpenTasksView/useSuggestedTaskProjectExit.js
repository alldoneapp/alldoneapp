import { useEffect, useRef, useState } from 'react'

import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'
import { GOAL_SECTION_EXIT_TOTAL_MS } from './goalSectionExitMotion'
import { subscribeToProjectTaskCompletions } from './projectTaskCompletionSignal'

/** A small tail keeps React's final unmount from cutting off the last collapse frame. */
export const SUGGESTED_TASK_PROJECT_EXIT_HOLD_MS = GOAL_SECTION_EXIT_TOTAL_MS + 120

/**
 * The row reports before its ~1s completion motion and held write. Keep that fact just long enough
 * for the open-task listener to decide the project is empty, but not long enough for an unrelated
 * later removal to borrow it.
 */
export const SUGGESTED_TASK_PROJECT_EXIT_MEMORY_MS = 5000

const animationsAreDisabled = () => process.env.NODE_ENV === 'test'

/**
 * AT-2550 — holds a project card for the quiet section exit when its only suggested task bypasses
 * the workflow and lands directly in Done.
 *
 * The completion signal alone never starts or holds anything. The board must independently say the
 * complete project is leaving, which preserves immediate removals caused by filters, access changes
 * and every non-bypass action. AT-2551's page-wide coloured sweep stays disconnected; this hook
 * only supplies a run id for the existing neutral fade-and-collapse motion.
 */
export default function useSuggestedTaskProjectExit({ projectId, enabled, lineWouldLeave }) {
    const reducedMotion = useReducedMotion()
    const active = enabled && !reducedMotion && !animationsAreDisabled()
    const [completionCandidate, setCompletionCandidate] = useState(null)
    const [previousLineWouldLeave, setPreviousLineWouldLeave] = useState(lineWouldLeave)
    const [exitRunId, setExitRunId] = useState(0)
    const [holding, setHolding] = useState(false)
    const consumedCompletionRef = useRef(null)

    useEffect(() => {
        if (!active) return undefined
        return subscribeToProjectTaskCompletions(projectId, event => {
            setCompletionCandidate({ taskId: event.taskId, completedAt: Date.now() })
        })
    }, [active, projectId])

    // Render-phase adjustment keeps the card mounted continuously. An effect would run after the
    // commit that already removed it, producing a one-frame disappear/reappear flash.
    if (lineWouldLeave !== previousLineWouldLeave) {
        setPreviousLineWouldLeave(lineWouldLeave)
        const recentUnconsumedCompletion =
            active &&
            completionCandidate &&
            completionCandidate !== consumedCompletionRef.current &&
            Date.now() - completionCandidate.completedAt <= SUGGESTED_TASK_PROJECT_EXIT_MEMORY_MS

        if (lineWouldLeave && recentUnconsumedCompletion) {
            consumedCompletionRef.current = completionCandidate
            setExitRunId(runId => runId + 1)
            setHolding(true)
        }
    }

    useEffect(() => {
        if (!holding) return undefined
        const timer = setTimeout(() => setHolding(false), SUGGESTED_TASK_PROJECT_EXIT_HOLD_MS)
        return () => clearTimeout(timer)
    }, [exitRunId, holding])

    return {
        exitRunId,
        holdProjectLine: active && holding,
    }
}
