import React from 'react'
import moment from 'moment'
import MilestoneDateTag from '../../GoalsView/MilestoneDateTag'
import { BACKLOG_DATE_NUMERIC } from '../../TaskListView/Utils/TasksHelper'

export default function DateTag({ completionMilestoneDate }) {
    const date = completionMilestoneDate === BACKLOG_DATE_NUMERIC ? 'Someday' : moment(completionMilestoneDate)
    return date ? <MilestoneDateTag date={date} inDetailedView={true} /> : null
}
