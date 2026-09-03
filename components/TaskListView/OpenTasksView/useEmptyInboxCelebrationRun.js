import { useMemo } from 'react'
import { useSelector } from 'react-redux'

import useTodayEmptyInboxCelebration from '../../SettingsView/Profile/Achievements/useTodayEmptyInboxCelebration'
import { getEmptyInboxDaysWithLegacyFallback } from '../../SettingsView/Profile/Achievements/AchievementsHelper'

/**
 * AT-2506 — the all-projects empty-inbox celebration, decided by the BOARD instead of by the block.
 *
 * `AllProjectsEmptyInbox` used to own this. That was right for AT-2445, which only had to answer
 * "is today earned, and have I shown it yet" — a question about a day, answerable from a component
 * that exists only while the inbox is empty. AT-2506 asks a question about a MOMENT ("did the inbox
 * just empty in front of you"), and that one is structurally unanswerable there: the block mounts
 * because the count reached zero, so its first render is already the empty state and there is no
 * previous count for it to compare against. Every mount would look identical to every clearing.
 *
 * The two boards, on the other hand, are mounted the whole time — they render the block
 * conditionally — so they see the count fall. Hence this hook, and hence the run id travelling down
 * as a prop. It is the same shape the per-project sweep already uses: `useProjectCompletedSweep`
 * lives in `OpenTasksByProject`, which survives its project's block being dropped, for exactly this
 * reason.
 *
 * Deliberately thin. Everything about WHETHER to celebrate — the achievement day, the once-per-day
 * marker, the reduced-motion stand-down, the refund of a run that was torn down before it played —
 * stays in `useTodayEmptyInboxCelebration`, which both boards and the Settings card share. This
 * only assembles the three inputs that hook needs from redux, once, so the two boards cannot
 * assemble them differently.
 *
 * @param {object} options
 * @param {boolean} options.enabled May this surface celebrate AND spend the day? It must carry the
 *   board's own evidence that the inbox is genuinely empty — i.e. the same condition that renders
 *   the block — because this hook is called even when the board is full. Without that, a user who
 *   earned the day this morning would be congratulated on arriving at a board with fifty tasks on
 *   it, since the achievement day stays true for the rest of the day.
 * @param {number} [options.todayInboxAmount] The board's own live count of today's open tasks. Pass
 *   `undefined` while it is not yet known rather than `0`: an absent answer must never be read as a
 *   full inbox that then emptied.
 * @returns {number} 0 while there is nothing to celebrate, then a stable non-zero run id shared by
 *   the headline, the confetti and the achievement card's dot — one event, not three animations.
 */
export default function useEmptyInboxCelebrationRun({ enabled, todayInboxAmount }) {
    // Field-level selectors rather than `state.loggedUser`: this runs inside the All Projects board,
    // which renders ~78 project blocks, and subscribing it to the whole user document would
    // re-render all of them on every unrelated user write (gold, xp, lastLogin — AT-2336).
    const userId = useSelector(state => state.loggedUser.uid)
    const emptyInboxDaysField = useSelector(state => state.loggedUser.emptyInboxDays)
    const lastDayEmptyInbox = useSelector(state => state.loggedUser.lastDayEmptyInbox)

    const emptyInboxDays = useMemo(
        () => getEmptyInboxDaysWithLegacyFallback({ emptyInboxDays: emptyInboxDaysField, lastDayEmptyInbox }),
        [emptyInboxDaysField, lastDayEmptyInbox]
    )

    return useTodayEmptyInboxCelebration(emptyInboxDays, enabled, userId, todayInboxAmount)
}
