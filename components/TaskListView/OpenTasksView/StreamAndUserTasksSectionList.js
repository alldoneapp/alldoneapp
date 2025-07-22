import React from 'react'
import { useSelector } from 'react-redux'

import StreamAndUserTasksSection from './StreamAndUserTasksSection'
import { STREAM_AND_USER_TASKS_INDEX } from '../../../utils/backends/openTasks'

export default function StreamAndUserTasksSectionList({
    projectId,
    dateIndex,
    projectIndex,
    instanceKey,
    isActiveOrganizeMode,
}) {
    const streamAndUserTasks = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][STREAM_AND_USER_TASKS_INDEX]
    )

    return (
        <>
            {streamAndUserTasks.map((item, index) => {
                const assigneeId = item[0]
                const taskByGoalsList = item[1]
                return (
                    <StreamAndUserTasksSection
                        key={assigneeId}
                        taskByGoalsList={taskByGoalsList}
                        assigneeId={assigneeId}
                        projectId={projectId}
                        dateIndex={dateIndex}
                        nestedTaskListIndex={index}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        projectIndex={projectIndex}
                        instanceKey={instanceKey}
                    />
                )
            })}
        </>
    )
}
