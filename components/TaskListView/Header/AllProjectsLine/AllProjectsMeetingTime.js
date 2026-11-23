import React from 'react'

import MeetingTimeToday from './MeetingTimeToday'
import useMeetingTimeToday from './useMeetingTimeToday'

// AT-3136: the data hook and its presentation, mounted by AllProjectsLine only on the task boards
// and My Day (`showMeetingTime`).
export default function AllProjectsMeetingTime() {
    const view = useMeetingTimeToday()
    return <MeetingTimeToday view={view} />
}
