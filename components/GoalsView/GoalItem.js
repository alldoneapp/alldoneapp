import React from 'react'
import { useSelector } from 'react-redux'

import DismissibleItem from '../UIComponents/DismissibleItem'
import GoalItemPresentation from './GoalItemPresentation'
import EditGoal from './EditGoal'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { useTaskHierarchy, useTaskHierarchyBackground } from '../TaskListView/TaskHierarchy'

export default function GoalItem({
    projectId,
    goal,
    setDismissibleRefs,
    openEdition,
    closeEdition,
    milestoneId,
    inDoneMilestone,
    isActiveOrganizeModeInTasks,
    inParentGoal,
    parentGoaltasks,
    areObservedTask,
    isEmptyGoal,
    refKey,
    setEditing,
    showingTasks,
    toggleTasksList,
}) {
    const taskHierarchy = useTaskHierarchy()
    const hierarchyBackgroundColor = useTaskHierarchyBackground()
    const activeDragGoalMode = useSelector(state => state.activeDragGoalMode === milestoneId)

    const setRef = ref => {
        setDismissibleRefs(ref, refKey)
    }

    const openEditionMode = () => {
        openEdition(refKey)
        setTimeout(() => {
            dismissAllPopups()
        })
    }

    const closeEditionMode = forceAction => {
        closeEdition(refKey, forceAction)
    }

    return (
        <DismissibleItem
            ref={setRef}
            defaultComponent={
                <GoalItemPresentation
                    hierarchyBackgroundColor={hierarchyBackgroundColor}
                    inHierarchyCard={taskHierarchy && (inParentGoal || isEmptyGoal)}
                    projectId={projectId}
                    onPress={openEditionMode}
                    goal={goal}
                    milestoneId={milestoneId}
                    inDoneMilestone={inDoneMilestone}
                    activeDragGoalMode={activeDragGoalMode}
                    isActiveOrganizeModeInTasks={isActiveOrganizeModeInTasks}
                    areObservedTask={areObservedTask}
                    inParentGoal={inParentGoal}
                    parentGoaltasks={parentGoaltasks}
                    isEmptyGoal={isEmptyGoal}
                />
            }
            modalComponent={
                <EditGoal
                    projectId={projectId}
                    onCancelAction={closeEditionMode}
                    goal={goal}
                    milestoneId={milestoneId}
                    inDoneMilestone={inDoneMilestone}
                    inParentGoal={inParentGoal}
                    isEmptyGoal={isEmptyGoal}
                    parentGoaltasks={parentGoaltasks}
                    areObservedTask={areObservedTask}
                    refKey={refKey}
                    showingTasks={showingTasks}
                    toggleTasksList={toggleTasksList}
                />
            }
            onToggleModal={setEditing}
        />
    )
}
