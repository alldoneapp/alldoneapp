import React from 'react'
import { View } from 'react-native'

import MeetingTimeToday, { getMeetingTimeDensity } from './MeetingTimeToday'
import { MEETING_TIME_READY, isAfterWorkView } from '../../../../utils/meetingTimeToday'
import { CALENDAR_SYNC_FAILED } from '../../../../utils/calendarSyncStatus'
import useMeetingTimeToday from './useMeetingTimeToday'
import DailyPlanEntry, { DAILY_PLAN_COMPACT_ENTRY_WIDTH } from '../../DailyPlan/DailyPlanEntry'

// AT-3136: the data hook and its presentation, mounted by AllProjectsLine only on the task boards
// and My Day (`showMeetingTime`). `lineWidth` is the measured width of the line on mobile sizes.
// AT-3142: "Plan my day" sits next to "Time to work" and plans against the same figures (one hook,
// no second set of listeners). On mobile the line is one fixed-height row (AT-3136), so the entry is
// compact there and its width is taken off the room the time display may use.
export default function AllProjectsMeetingTime({ mobile = false, lineWidth = 0 }) {
    const view = useMeetingTimeToday()
    const withWarning = view?.status === MEETING_TIME_READY && view.syncStatus === CALENDAR_SYNC_FAILED
    const roomForTime = mobile && lineWidth ? Math.max(1, lineWidth - DAILY_PLAN_COMPACT_ENTRY_WIDTH) : lineWidth
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: mobile ? 1 : 0 }}>
            <MeetingTimeToday
                view={view}
                density={getMeetingTimeDensity(mobile, roomForTime, withWarning, isAfterWorkView(view))}
            />
            <DailyPlanEntry meetingView={view} compact={mobile} />
        </View>
    )
}
