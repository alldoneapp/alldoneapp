import React from 'react'
import { useSelector } from 'react-redux'

import SuggestedSection from './SuggestedSection'
import { SUGGESTED_TASK_INDEX } from '../../../utils/backends/openTasks'

export default function SuggestedSectionList({ projectId, dateIndex, instanceKey, isActiveOrganizeMode }) {
    const suggestedTasks = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][SUGGESTED_TASK_INDEX]
    )

    return (
        <>
            {suggestedTasks.map((item, index) => {
                const suggestedUserId = item[0]
                const taskByGoalsList = item[1]
                return (
                    <SuggestedSection
                        key={suggestedUserId}
                        taskByGoalsList={taskByGoalsList}
                        projectId={projectId}
                        dateIndex={dateIndex}
                        nestedTaskListIndex={index}
                        suggestedUserId={suggestedUserId}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        instanceKey={instanceKey}
                    />
                )
            })}
        </>
    )
}
