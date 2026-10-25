import React from 'react'
import { useSelector } from 'react-redux'

import CalendarSection from './CalendarSection'
import { CALENDAR_TASK_INDEX } from '../../../utils/backends/openTasks'

export default function CalendarSectionContainer({ projectId, dateIndex, instanceKey, isActiveOrganizeMode }) {
    const calendarTasks = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][CALENDAR_TASK_INDEX]
    )

    return (
        <CalendarSection
            projectId={projectId}
            calendarEvents={calendarTasks}
            dateIndex={dateIndex}
            isActiveOrganizeMode={isActiveOrganizeMode}
            instanceKey={instanceKey}
        />
    )
}
