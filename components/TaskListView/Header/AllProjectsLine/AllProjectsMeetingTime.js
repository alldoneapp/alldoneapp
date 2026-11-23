import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import MeetingTimeToday from './MeetingTimeToday'
import useMeetingTimeToday from './useMeetingTimeToday'
import DailyPlanEntry from '../../DailyPlan/DailyPlanEntry'

// AT-3136: the data hook and its presentation, mounted by AllProjectsLine only on the task boards
// and My Day (`showMeetingTime`). AT-3142: "Plan my day" sits next to "Time to work" and plans
// against the same figures (one hook, no second set of listeners).
export default function AllProjectsMeetingTime() {
    const view = useMeetingTimeToday()
    const mobile = useSelector(state => state.smallScreenNavigation)
    return (
        <View
            style={{
                flexDirection: 'row',
                alignItems: 'center',
                flexWrap: mobile ? 'wrap' : 'nowrap',
                justifyContent: mobile ? 'flex-end' : 'flex-start',
                flexShrink: mobile ? 1 : 0,
            }}
        >
            <MeetingTimeToday view={view} />
            <DailyPlanEntry meetingView={view} />
        </View>
    )
}
