import React from 'react'
import { useSelector } from 'react-redux'

import { ALL_GOALS_ID } from '../AllSections/allSectionHelper'
import GoalsUserGroup from './GoalsUserGroup'
import AllGoalsUserGroup from './AllGoalsUserGroup'

export default function GoalsByAssignee({
    projectId,
    milestoneId,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    inDoneMilestone,
    activeDragGoalMode,
    goalsByAssigneeArray,
    milestoneGoals,
}) {
    const currentUserId = useSelector(state => state.currentUser.uid)
    return (
        <>
            {goalsByAssigneeArray.map((goalsByAssignee, index) => {
                const assigneeId = goalsByAssignee[0]
                const goalsList = goalsByAssignee[1]
                return assigneeId === ALL_GOALS_ID ? (
                    <AllGoalsUserGroup
                        key={assigneeId}
                        projectId={projectId}
                        milestoneId={milestoneId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        inDoneMilestone={inDoneMilestone}
                        goals={goalsList}
                        activeDragGoalMode={activeDragGoalMode}
                        milestoneGoals={milestoneGoals}
                    />
                ) : (
                    <GoalsUserGroup
                        key={assigneeId}
                        projectId={projectId}
                        milestoneId={milestoneId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        inDoneMilestone={inDoneMilestone}
                        goals={goalsList}
                        assigneeId={assigneeId}
                        activeDragGoalMode={activeDragGoalMode}
                        milestoneGoals={milestoneGoals}
                    />
                )
            })}
        </>
    )
}
