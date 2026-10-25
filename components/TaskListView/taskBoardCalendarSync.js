import { useEffect, useRef } from 'react'
import { shallowEqual, useSelector } from 'react-redux'

import { checkIfCalendarConnected } from '../../utils/backends/firestore'

/**
 * AT-2480 - the task board refreshes the user's CALENDARS, not the selected project's.
 *
 * A meeting only exists in Alldone once `syncCalendarEventsSecondGen` has run for the day: the
 * callable fetches the connected calendar's events for the user's local day and writes them as
 * tasks (`functions/GoogleCalendarTasks/calendarTasks.js`). There is NO scheduled server-side
 * calendar sync - that callable is the only entry point - so a day whose sync has not run yet has
 * no meetings anywhere, in any view.
 *
 * The board used to trigger it from `OpenTasksByProjectHandler`, once per rendered project block
 * and gated on `inSelectedProject`. That is why meetings "only appear when the private project is
 * selected": in All Projects the effect no-ops for every project, so opening the board never
 * pulled the day's events, and they materialised only after the user selected the one project
 * holding the calendar connection. Two smaller cases had the same shape - selecting a project that
 * merely RECEIVES routed meetings (`calendarProjectRouting` can land an event in a project with no
 * connection of its own) never synced either, and neither did selecting one of several connected
 * projects, which refreshed only that project's calendar.
 *
 * The connection is a property of the USER (`loggedUser.apisConnected[projectId].calendar`), so
 * the refresh is resolved from there and runs once for the whole board rather than once per
 * project block - which is what the old per-project effect was deliberately keeping out of the
 * All Projects mount fan-out. My Day (`MyDayView`) and the unified Email line already work exactly
 * this way; this closes the gap for the project board.
 *
 * Deliberately NOT gated on `state.isLoadingData`: the failure this fixes is "the sync never ran",
 * so a gate that can stay closed would reintroduce it. The short delay is enough to let the first
 * task snapshots claim the network, and `checkIfCalendarConnected` carries its own one-minute
 * per-project cooldown, so a re-render or a project switch cannot turn this into a call storm.
 */

export const TASK_BOARD_CALENDAR_SYNC_DELAY_MS = 500

export const getCalendarConnectedProjectIdsFromApis = apisConnected =>
    Object.entries(apisConnected || {})
        .filter(([projectId, apis]) => !!projectId && !!apis?.calendar)
        .map(([projectId]) => projectId)
        // A stable order keeps the effect's key stable, so an unrelated `apisConnected` rewrite
        // that preserves the same connections cannot re-trigger the sync.
        .sort()

export const useTaskBoardCalendarSync = () => {
    const apisConnected = useSelector(state => state.loggedUser.apisConnected, shallowEqual)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    // The assistant profile board renders the same task views for a different `currentUser`.
    // Only the signed-in human owns these calendar connections.
    const currentUserId = useSelector(state => state.currentUser.uid)

    const syncedKeyRef = useRef(null)

    const canSync = !isAnonymous && !!loggedUserId && currentUserId === loggedUserId
    const projectIds = canSync ? getCalendarConnectedProjectIdsFromApis(apisConnected) : []
    const syncKey = projectIds.join(',')

    useEffect(() => {
        if (!syncKey || syncedKeyRef.current === syncKey) return undefined

        const timer = setTimeout(() => {
            syncedKeyRef.current = syncKey
            syncKey.split(',').forEach(projectId => checkIfCalendarConnected(projectId))
        }, TASK_BOARD_CALENDAR_SYNC_DELAY_MS)

        return () => clearTimeout(timer)
    }, [syncKey])
}
