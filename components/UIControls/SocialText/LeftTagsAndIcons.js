import React from 'react'
import { useSelector } from 'react-redux'

import MilestoneDateTag from '../../GoalsView/MilestoneDateTag'
import DoneStateWrapper from '../../GoalsView/DoneStateWrapper'
import TimeTagWrapper from '../../Tags/TimeTagWrapper'
import CompletedTimeTag from '../../Tags/CompletedTimeTag'
import CalendarTag from '../../Tags/CalendarTag'

export default function LeftTagsAndIcons({
    projectId,
    milestoneDate,
    milestone,
    isActiveMilestone,
    leftCustomElement,
    activeCalendarStyle,
    task,
}) {
    return (
        <>
            {!activeCalendarStyle && task && task.calendarData && !task.completedTime && (
                <CalendarTag calendarData={task.calendarData} containerStyle={{ marginRight: 8 }} />
            )}
            {milestone && (isActiveMilestone || milestone.done) && (
                <DoneStateWrapper projectId={projectId} milestone={milestone} />
            )}
            {milestoneDate && <MilestoneDateTag date={milestoneDate} />}
            {leftCustomElement && leftCustomElement}
        </>
    )
}
