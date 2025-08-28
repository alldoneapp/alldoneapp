import React from 'react'

import GoalAssigneeCapacityWrapper from './GoalAssigneeCapacityWrapper'
import AssigneesIcon from './EditGoalsComponents/AssigneesIcon'
import { getHandlerData } from '../TaskListView/Utils/TasksHelper'

export default function GoalItemAssigneesArea({
    projectId,
    goal,
    assigneesIds,
    assigneesCapacity,
    tagStyle,
    disableTagsActions,
    inDoneMilestone,
}) {
    return (
        <>
            {!inDoneMilestone &&
                assigneesIds.map(assigneeId => {
                    const { handler: assignee, isUser, isPublicForLoggedUser } = getHandlerData(assigneeId, projectId)
                    return assignee && isPublicForLoggedUser ? (
                        <GoalAssigneeCapacityWrapper
                            key={assigneeId}
                            assignee={assignee}
                            assigneeId={assigneeId}
                            projectId={projectId}
                            goal={goal}
                            capacity={assigneesCapacity[assigneeId]}
                            tagStyle={tagStyle}
                            disabled={disableTagsActions || !isUser}
                        />
                    ) : null
                })}
            {inDoneMilestone && (
                <AssigneesIcon
                    assigneesIds={goal.assigneesIds}
                    disableModal={true}
                    style={[{ marginLeft: 8 }, tagStyle]}
                    projectId={projectId}
                />
            )}
        </>
    )
}
