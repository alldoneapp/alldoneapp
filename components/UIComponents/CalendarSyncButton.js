import React from 'react'
import { useSelector } from 'react-redux'

import ReloadCalendar from './ReloadCalendar'
import { checkIfCalendarConnected } from '../../utils/backends/firestore'

/**
 * Manual "re-sync my calendar" affordance.
 *
 * AT-2252 removed the dedicated "Google Calendar" task-list section, and that section was the only
 * place this control lived. It now sits as a small icon on the day header instead, and only for a
 * project that actually has a calendar connected - a project without one has nothing to sync.
 */
export default function CalendarSyncButton({ projectId, containerStyle, size = 16 }) {
    const isCalendarConnected = useSelector(state => {
        const apisConnected = state.loggedUser.apisConnected
        return !!(projectId && apisConnected && apisConnected[projectId] && apisConnected[projectId].calendar)
    })

    if (!isCalendarConnected) return null

    return (
        <ReloadCalendar
            projectId={projectId}
            Promise={checkIfCalendarConnected}
            containerStyle={containerStyle}
            size={size}
        />
    )
}
