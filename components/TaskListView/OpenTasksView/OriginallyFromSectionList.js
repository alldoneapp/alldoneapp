import React from 'react'
import { useSelector } from 'react-redux'

import OriginallyFromSection from './OriginallyFromSection'
import { WORKFLOW_TASK_INDEX } from '../../../utils/backends/openTasks'

export default function OriginallyFromSectionList({ projectId, dateIndex, instanceKey, isActiveOrganizeMode }) {
    const receivedFrom = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][WORKFLOW_TASK_INDEX])

    return (
        <>
            {receivedFrom.map((item, index) => {
                const assigneeId = item[0]
                const taskByGoalsList = item[1]
                return (
                    <OriginallyFromSection
                        key={index}
                        taskByGoalsList={taskByGoalsList}
                        assigneeId={assigneeId}
                        projectId={projectId}
                        userIndex={index}
                        dateIndex={dateIndex}
                        nestedTaskListIndex={index}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        instanceKey={instanceKey}
                    />
                )
            })}
        </>
    )
}
