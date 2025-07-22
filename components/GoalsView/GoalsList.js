import React from 'react'
import GoalItem from './GoalItem'

export default function GoalsList({
    projectId,
    milestoneId,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    inDoneMilestone,
    assigneeId,
    goals,
}) {
    return (
        <>
            {goals.map(goal => {
                const refKey = `${goal.id}${milestoneId}${assigneeId}`
                return (
                    <GoalItem
                        key={goal.id}
                        goal={goal}
                        projectId={projectId}
                        setDismissibleRefs={setDismissibleRefs}
                        openEdition={openEdition}
                        closeEdition={closeEdition}
                        milestoneId={milestoneId}
                        inDoneMilestone={inDoneMilestone}
                        refKey={refKey}
                    />
                )
            })}
        </>
    )
}
