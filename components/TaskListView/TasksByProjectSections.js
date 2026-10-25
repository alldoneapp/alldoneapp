import React from 'react'
import { useSelector } from 'react-redux'

import OpenTasksSection from './OpenTasksSection'
import PendingTasksSection from './PendingTasksSection'
import DoneTasksSection from './DoneTasksSection'
import InProgressTasksSection from './InProgressTasksSection'
import { useTaskBoardCalendarSync } from './taskBoardCalendarSync'

export default function TasksByProjectSections() {
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)

    // AT-2480: the day's calendar pull belongs to the board, not to a rendered project block.
    // This component stays mounted across the All Projects <-> selected project switch and across
    // the Open/In progress/Workflow/Done toggle, so the sync runs once here instead of once per
    // project - and, crucially, in All Projects too. (My Day is the sibling branch in
    // `TasksSections` and does its own sync in `MyDayView`.)
    useTaskBoardCalendarSync()

    const inOpenSection = taskViewToggleSection === 'Open'
    const inPendingSection = taskViewToggleSection === 'Workflow'
    const inProgressSection = taskViewToggleSection === 'In progress'
    const inDoneSection = taskViewToggleSection === 'Done'

    return inOpenSection ? (
        <OpenTasksSection />
    ) : inProgressSection ? (
        <InProgressTasksSection />
    ) : inPendingSection ? (
        <PendingTasksSection />
    ) : inDoneSection ? (
        <DoneTasksSection />
    ) : null
}
