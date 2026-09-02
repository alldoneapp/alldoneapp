import { useLayoutEffect, useRef } from 'react'
import { useSelector } from 'react-redux'
import moment from 'moment'

import { EMPTY_INBOX_DATE_FORMAT } from '../components/SettingsView/Profile/Achievements/AchievementsHelper'
import {
    didProjectReachEmptyInbox,
    markProjectEmptyInboxDayReached,
} from '../components/TaskListView/OpenTasksView/projectEmptyInboxCelebrationMarker'

/**
 * AT-2492 — records, app-wide, the moment a project's today list goes from "has tasks" to "clear".
 *
 * The sibling of `useReachEmptyInbox`, and mounted next to it in `InitLoadView` for the same reason:
 * the transition has to be caught wherever the user happens to be when they complete that last task.
 * Clearing a project's last task from My Day, from the All Projects board or from a chat is the
 * ordinary case, and none of those has the project's own task section mounted — so without this the
 * celebration would only ever fire for someone who happened to be looking at that one project's
 * board at the exact moment the Firestore write landed. That is the same narrowness AT-2418 had to
 * fix for the all-projects celebration, and this is the same fix one level down.
 *
 * It only ever WRITES a record. Whether that record is worth a celebration — and the once-per-day
 * accounting for it — belongs to `useProjectEmptyInboxCelebration` at the board, which also does its
 * own transition detection for the case where the project's board IS open (effects run
 * child-before-parent, so this hook cannot be relied on to have run first on that tick).
 *
 * Costs nothing new: `sidebarNumbers` is already the live per-project count behind the sidebar
 * badges, so this adds no listener, no Firestore read and no write.
 */
export default function useReachProjectEmptyInbox() {
    const sidebarNumbers = useSelector(state => state.sidebarNumbers)
    const userId = useSelector(state => state.loggedUser.uid)
    const previousCountsRef = useRef({})

    useLayoutEffect(() => {
        const previousCounts = previousCountsRef.current
        const nextCounts = {}
        const todayKey = moment().format(EMPTY_INBOX_DATE_FORMAT)

        Object.keys(sidebarNumbers || {}).forEach(projectId => {
            // `loading` is a flag on the same map, not a project. Reading it as one would compare a
            // boolean against a count on every settle.
            if (projectId === 'loading') return

            const count = sidebarNumbers[projectId]?.[userId]
            nextCounts[projectId] = count

            if (!userId) return
            if (!didProjectReachEmptyInbox(previousCounts[projectId], count)) return

            markProjectEmptyInboxDayReached(userId, projectId, todayKey)
        })

        // Replaced wholesale rather than merged: a project that has left the map (unwatched, or the
        // user switched accounts) must not keep a stale positive count that a later re-appearance at
        // zero would read as a completion.
        previousCountsRef.current = nextCounts
    }, [sidebarNumbers, userId])

    return null
}
