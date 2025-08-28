import React from 'react'
import { useSelector } from 'react-redux'

import ObservedFromSection from './ObservedFromSection'
import { OBSERVED_TASKS_INDEX } from '../../../utils/backends/openTasks'

export default function ObservedFromSectionList({
    projectIndex,
    projectId,
    dateIndex,
    instanceKey,
    isActiveOrganizeMode,
}) {
    const observedTasks = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][OBSERVED_TASKS_INDEX]
    )

    return (
        <>
            {observedTasks.map((item, index) => {
                const assigneeId = item[0]
                const taskByGoalsList = item[1]
                return (
                    <ObservedFromSection
                        key={assigneeId}
                        taskByGoalsList={taskByGoalsList}
                        assigneeId={assigneeId}
                        projectId={projectId}
                        dateIndex={dateIndex}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        nestedTaskListIndex={index}
                        instanceKey={instanceKey}
                        projectIndex={projectIndex}
                    />
                )
            })}
        </>
    )
}
