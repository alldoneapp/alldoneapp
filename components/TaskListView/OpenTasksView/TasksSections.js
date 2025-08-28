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
