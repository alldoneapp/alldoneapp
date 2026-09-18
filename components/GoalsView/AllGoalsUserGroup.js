import React from 'react'

import GoalsList from './GoalsList'
import GoalListDroppable from '../DragGoalsSystem/GoalListDroppable'
import { ALL_GOALS_ID } from '../AllSections/allSectionHelper'
import FocusAreaGoals from './FocusAreaGoals'

export default function AllGoalsUserGroup({
    projectId,
    milestoneId,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    inDoneMilestone,
    goals,
    activeDragGoalMode,
    milestoneGoals,
}) {
    return (
        <FocusAreaGoals projectId={projectId} goals={goals} activeDragGoalMode={activeDragGoalMode}>
            {(groupGoals, focusAreaId) =>
                activeDragGoalMode ? (
                    <GoalListDroppable
                        projectId={projectId}
                        milestoneId={milestoneId}
                        goalsList={groupGoals}
                        focusAreaId={focusAreaId}
                        userId={ALL_GOALS_ID}
                        milestoneGoals={milestoneGoals}
                    />
                ) : (
                    <GoalsList
                        projectId={projectId}
                        milestoneId={milestoneId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        inDoneMilestone={inDoneMilestone}
                        assigneeId={ALL_GOALS_ID}
                        goals={groupGoals}
                    />
                )
            }
        </FocusAreaGoals>
    )
}
