import React from 'react'
import { DragDropContext } from 'react-beautiful-dnd'
import { useSelector } from 'react-redux'

import MentionSection from './MentionSection'
import MainSection from './MainSection'
import { onBeforeCapture, onDragEnd } from '../../DragSystem/DragHelper'
import EmailSection from './EmailSection'
import store from '../../../redux/store'
import {
    CALENDAR_TASK_INDEX,
    EMAIL_TASK_INDEX,
    MENTION_TASK_INDEX,
    OBSERVED_TASKS_INDEX,
    STREAM_AND_USER_TASKS_INDEX,
    SUGGESTED_TASK_INDEX,
    WORKFLOW_TASK_INDEX,
} from '../../../utils/backends/openTasks'
import SuggestedSectionList from './SuggestedSectionList'
import OriginallyFromSectionList from './OriginallyFromSectionList'
import ObservedFromSectionList from './ObservedFromSectionList'
import StreamAndUserTasksSectionList from './StreamAndUserTasksSectionList'
import CalendarSectionContainer from './CalendarSectionContainer'

export default function TasksSections({
    projectId,
    dateIndex,
    projectIndex,
    instanceKey,
    isActiveOrganizeMode,
    pressedShowMoreMainSection,
    setPressedShowMoreMainSection,
}) {
    // DEBUG: Log entire filteredOpenTasksStore structure
    const filteredOpenTasksStoreForInstance = useSelector(state => state.filteredOpenTasksStore[instanceKey])
    console.log(
        `[FILTERED STORE DEBUG] TasksSections - instanceKey: ${instanceKey}, dateIndex: ${dateIndex}, projectId: ${projectId}`
    )
    console.log(`[FILTERED STORE DEBUG] Full store for instance:`, filteredOpenTasksStoreForInstance)
    if (filteredOpenTasksStoreForInstance && filteredOpenTasksStoreForInstance[dateIndex]) {
        const dateData = filteredOpenTasksStoreForInstance[dateIndex]
        console.log(`[FILTERED STORE DEBUG] Date ${dateIndex} data:`, dateData)

        // DEBUG: Log task distribution across sections
        console.log(`[TASK DISTRIBUTION DEBUG] Task breakdown:`)
        console.log(`  - Date/Total: ${dateData[0]} / ${dateData[1]}`)
        console.log(`  - Estimation Tasks (index 2): ${Array.isArray(dateData[2]) ? dateData[2].length : dateData[2]}`)
        console.log(`  - Main Tasks (index 3): ${Array.isArray(dateData[3]) ? dateData[3].length : 'N/A'}`)
        console.log(`  - Mention Tasks (index 4): ${Array.isArray(dateData[4]) ? dateData[4].length : 'N/A'}`)
        console.log(`  - Suggested Tasks (index 5): ${Array.isArray(dateData[5]) ? dateData[5].length : 'N/A'}`)
        console.log(`  - Workflow Tasks (index 6): ${Array.isArray(dateData[6]) ? dateData[6].length : 'N/A'}`)
        console.log(`  - Calendar Tasks (index 7): ${Array.isArray(dateData[7]) ? dateData[7].length : 'N/A'}`)
        console.log(`  - Observed Tasks (index 8): ${Array.isArray(dateData[8]) ? dateData[8].length : 'N/A'}`)
        console.log(`  - Stream/User Tasks (index 9): ${Array.isArray(dateData[9]) ? dateData[9].length : 'N/A'}`)
        console.log(`  - Unknown Tasks (index 10): ${Array.isArray(dateData[10]) ? dateData[10].length : 'N/A'}`)
        console.log(`  - Email Tasks (index 11): ${Array.isArray(dateData[11]) ? dateData[11].length : 'N/A'}`)
        console.log(`  - Empty Section (index 12): ${Array.isArray(dateData[12]) ? dateData[12].length : 'N/A'}`)

        // Calculate total displayed tasks
        let totalDisplayed = 0
        for (let i = 3; i <= 12; i++) {
            if (Array.isArray(dateData[i])) {
                totalDisplayed += dateData[i].length
            }
        }
        console.log(
            `[TASK DISTRIBUTION DEBUG] Total tasks in display sections: ${totalDisplayed}, Firebase count: ${dateData[1]}`
        )
    }

    const mentionTasksAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][MENTION_TASK_INDEX].length
    )
    const suggestedTasksSectionsAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][SUGGESTED_TASK_INDEX].length
    )
    const receivedFromTasksSectionsAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][WORKFLOW_TASK_INDEX].length
    )
    const streamAndUserTasksSectionsAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][STREAM_AND_USER_TASKS_INDEX].length
    )
    const observedTasksSectionsAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][OBSERVED_TASKS_INDEX].length
    )
    const calendarTasksAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][CALENDAR_TASK_INDEX].length
    )
    const emailTasksAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][EMAIL_TASK_INDEX].length
    )

    const beforeCapture = dragData => {
        const { subtaskByTaskStore } = store.getState()
        const subtaskByTask = subtaskByTaskStore[instanceKey] ? subtaskByTaskStore[instanceKey] : {}
        onBeforeCapture(subtaskByTask, dragData)
    }

    const dragEnd = result => {
        const { openTasksStore, subtaskByTaskStore } = store.getState()
        const subtaskByTask = subtaskByTaskStore[instanceKey] ? subtaskByTaskStore[instanceKey] : {}
        const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []
        onDragEnd(result, openTasks, subtaskByTask, instanceKey)
    }

    return (
        <DragDropContext onDragEnd={dragEnd} onBeforeCapture={beforeCapture}>
            <MainSection
                projectId={projectId}
                dateIndex={dateIndex}
                isActiveOrganizeMode={isActiveOrganizeMode}
                projectIndex={projectIndex}
                instanceKey={instanceKey}
                pressedShowMoreMainSection={pressedShowMoreMainSection}
                setPressedShowMoreMainSection={setPressedShowMoreMainSection}
            />

            {mentionTasksAmount > 0 && (
                <MentionSection
                    projectId={projectId}
                    dateIndex={dateIndex}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                    instanceKey={instanceKey}
                />
            )}

            {suggestedTasksSectionsAmount > 0 && (
                <SuggestedSectionList
                    projectId={projectId}
                    dateIndex={dateIndex}
                    instanceKey={instanceKey}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}

            {receivedFromTasksSectionsAmount > 0 && (
                <OriginallyFromSectionList
                    projectId={projectId}
                    dateIndex={dateIndex}
                    instanceKey={instanceKey}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}

            {calendarTasksAmount > 0 && (
                <CalendarSectionContainer
                    projectId={projectId}
                    dateIndex={dateIndex}
                    instanceKey={instanceKey}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}

            {emailTasksAmount > 0 && (
                <EmailSection
                    projectId={projectId}
                    instanceKey={instanceKey}
                    dateIndex={dateIndex}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}

            {observedTasksSectionsAmount > 0 && (
                <ObservedFromSectionList
                    projectId={projectId}
                    dateIndex={dateIndex}
                    instanceKey={instanceKey}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                    projectIndex={projectIndex}
                />
            )}

            {streamAndUserTasksSectionsAmount > 0 && (
                <StreamAndUserTasksSectionList
                    projectId={projectId}
                    dateIndex={dateIndex}
                    projectIndex={projectIndex}
                    instanceKey={instanceKey}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
        </DragDropContext>
    )
}
