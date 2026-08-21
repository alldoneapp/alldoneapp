import { useEffect, useRef, useState } from 'react'

import { getTaskRoutingConfirmation, getTaskRoutingProcessing } from '../../../../utils/taskRoutingActivity'

/**
 * AT-2381 — turns the pure routing state in `utils/taskRoutingActivity.js` into something a
 * row can render, and owns the one thing that state cannot express on its own: a confirmation
 * has to play ONCE.
 *
 * The processing sparkle needs no latch — it is a level, true for exactly as long as the
 * server is still deciding, and it ends when the snapshot with the settled status arrives.
 * The confirmation is the opposite: it is an edge, and the evidence for it (`status: 'routed'`
 * plus `resolvedAt`) stays on the task document forever. Without a latch it would replay every
 * time the row remounted inside the freshness window — which in a virtualised list means every
 * time the user scrolled it off screen and back.
 *
 * This hook runs on EVERY task row, so it is deliberately cheap: one `useState`, one effect over
 * primitives, and a pure derivation. In particular it does NOT read the reduced-motion
 * preference — `useReducedMotion` registers a `matchMedia` listener per call, and paying that on
 * every row of a long list to serve the handful that are actually sparkling is the wrong trade.
 * The two presentational components subscribe for themselves instead, and the row only mounts
 * them when there is something to show.
 */

// Sized from the agreed motion spec: burst ~600ms, glow fades over ~1.8s, and the label chip
// outlives both so the user can still read WHAT changed after the motion has settled.
export const ROUTING_BURST_DURATION_MS = 600
export const ROUTING_GLOW_DURATION_MS = 1800
export const ROUTING_CONFIRMATION_VISIBLE_MS = 4000

/**
 * Signatures of confirmations already played this session. A signature pins the task AND the
 * `resolvedAt` of the decision, so a genuinely new decision on the same task (the task is moved
 * again, or routed into a goal after being routed into a project) still plays.
 *
 * Bounded because a long dogfooding session on an account with many projects would otherwise
 * grow it without limit. Oldest-first eviction is safe: evicting an entry can at worst replay a
 * confirmation the user saw thousands of tasks ago, which is indistinguishable from a fresh one
 * having simply aged out of the freshness window.
 */
const MAX_REMEMBERED_CONFIRMATIONS = 500
const playedConfirmations = new Set()

const hasPlayed = signature => playedConfirmations.has(signature)

const markPlayed = signature => {
    if (playedConfirmations.size >= MAX_REMEMBERED_CONFIRMATIONS) {
        const oldest = playedConfirmations.values().next().value
        if (oldest !== undefined) playedConfirmations.delete(oldest)
    }
    playedConfirmations.add(signature)
}

// Test-only seam. The latch is module state on purpose (it must survive the row unmounting,
// which is the whole point), so suites need a way back to a clean slate.
export const resetPlayedRoutingConfirmations = () => playedConfirmations.clear()

/**
 * @param {object} task a task as mapped by `mapTaskData`
 * @param {string} projectId the project this row is rendered in
 * @returns {{ processing: null|{subject}, confirmation: null|{subject, fromProjectId, goalId} }}
 */
export default function useTaskRoutingActivity(task, projectId) {
    const [confirmation, setConfirmation] = useState(null)
    const timeoutRef = useRef(null)

    const taskId = task?.id
    // Depending on primitives rather than on `task` keeps the effect from re-running on every
    // unrelated field change — a task row re-renders constantly (drag state, focus, counters).
    const projectRoutingStatus = task?.projectRouting?.status
    const projectRoutingResolvedAt = task?.projectRouting?.resolvedAt
    const movedFromProjectId = task?.projectRouting?.movedFromProjectId
    const goalSuggestionStatus = task?.goalSuggestion?.status
    const goalSuggestionResolvedAt = task?.goalSuggestion?.resolvedAt
    const parentGoalId = task?.parentGoalId

    useEffect(() => {
        const candidate = getTaskRoutingConfirmation(task, projectId, Date.now())
        if (!candidate || hasPlayed(candidate.signature)) return undefined

        markPlayed(candidate.signature)
        setConfirmation(candidate)

        timeoutRef.current = setTimeout(() => setConfirmation(null), ROUTING_CONFIRMATION_VISIBLE_MS)
        return () => clearTimeout(timeoutRef.current)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        taskId,
        projectId,
        projectRoutingStatus,
        projectRoutingResolvedAt,
        movedFromProjectId,
        goalSuggestionStatus,
        goalSuggestionResolvedAt,
        parentGoalId,
    ])

    // A settled decision ends the sparkle even before its snapshot changes anything else, and a
    // confirmation showing at the same time as "still working" would contradict itself.
    const processing = confirmation ? null : getTaskRoutingProcessing(task)

    return { processing, confirmation }
}
