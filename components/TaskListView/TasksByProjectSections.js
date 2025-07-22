import React from 'react'
import { useSelector } from 'react-redux'

import OpenTasksSection from './OpenTasksSection'
import PendingTasksSection from './PendingTasksSection'
import DoneTasksSection from './DoneTasksSection'
import InProgressTasksSection from './InProgressTasksSection'

export default function TasksByProjectSections() {
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)

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
