import React from 'react'

import MeetingTimeToday, { getMeetingTimeDensity } from './MeetingTimeToday'
import { MEETING_TIME_READY } from '../../../../utils/meetingTimeToday'
import { CALENDAR_SYNC_FAILED } from '../../../../utils/calendarSyncStatus'
import useMeetingTimeToday from './useMeetingTimeToday'

// AT-3136: the data hook and its presentation, mounted by AllProjectsLine only on the task boards
// and My Day (`showMeetingTime`). `lineWidth` is the measured width of the line on mobile sizes.
export default function AllProjectsMeetingTime({ mobile = false, lineWidth = 0 }) {
    const view = useMeetingTimeToday()
    const withWarning = view?.status === MEETING_TIME_READY && view.syncStatus === CALENDAR_SYNC_FAILED
    return <MeetingTimeToday view={view} density={getMeetingTimeDensity(mobile, lineWidth, withWarning)} />
}
