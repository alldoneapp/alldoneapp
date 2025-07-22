import React from 'react'
import moment from 'moment'

import TimeTag from './TimeTag'

export default function CompletedTimeTag({ task }) {
    const { completedTime } = task

    const { startTime, endTime } = completedTime
    const time = { startDate: moment(startTime), endDate: moment(endTime) }
    return <TimeTag time={time} disabled={true} containerStyle={{ marginRight: 8 }} />
}
