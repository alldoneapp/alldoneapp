import React, { useEffect, useState, useRef, useDebugValue } from 'react'
import { StyleSheet, View } from 'react-native'
import GoalItem from '../../GoalsView/GoalItem'
import Backend from '../../../utils/BackendBridge'
import { useSelector } from 'react-redux'
import TasksList from './TasksList'
import NewTaskSection from './NewTaskSection'
import SortModeActiveInfo from '../../GoalsView/SortModeActiveInfo'
import v4 from 'uuid/v4'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../../Guides/guidesHelper'
import LockedGoalModal from '../../UIComponents/FloatModals/LockedGoalModal/LockedGoalModal'
import GoalIndicator from '../GoalIndicator'
import useOptimisticGoalPostponeHidden from '../../GoalsView/useOptimisticGoalPostponeHidden'
import useGoalCompletedFlourish from './useGoalCompletedFlourish'

export default function ParentGoalSection({
    projectId,
    dateIndex,
    goalId,
    isActiveOrganizeMode,
    taskList,
    taskListIndex,
    containerStyle,
    nestedTaskListIndex,
    isObservedTask,
    isToReviewTask,
    isSuggested,
    inMainSection,
    goalIndex,
    amountToRender,
    instanceKey,
    expandTasksList,
    isTemplateProject,
    focusedTaskId,
    celebrateCompletion = false,
}) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const unlockedKeysByGuides = useSelector(state => state.loggedUser.unlockedKeysByGuides)
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const subtaskByTask = subtaskByTaskStore ? subtaskByTaskStore : {}
    const activeEditMode = useSelector(state => state.activeEditMode)
    const cachedGoal = useSelector(state => state.goalsByProjectInTasks?.[projectId]?.[goalId])
    // The task cold-start projection restores the previous goal snapshot before this component
    // mounts. Use it for the first paint instead of hiding the task rows until the per-goal live
    // listener completes; that listener still replaces this value as soon as Firestore answers.
    const [goal, setGoal] = useState(cachedGoal || null)
    const [editing, setEditing] = useState(false)
    const [showingTasks, setShowingTasks] = useState(true)
    const dismissibleRef = useRef(null)
    // AT-2160: keep this above the early return — hooks must run on every render.
    const hiddenByOptimisticPostpone = useOptimisticGoalPostponeHidden(projectId, goalId)
    /**
     * AT-2507 — the run id the goal row celebrates with when the last of the tasks below it is
     * ticked. Lives here rather than in `MainSection` because this is the component that owns one
     * goal's task list, and rather than in `GoalItemPresentation` because that row is also the
     * goals-board row, which has no day-scoped task list at all.
     */
    const completedRunId = useGoalCompletedFlourish({
        projectId,
        goalId,
        taskList,
        enabled: celebrateCompletion,
    })

    const setDismissibleRefs = ref => {
        dismissibleRef.current = ref
    }

    const openEdition = () => {
        if (!activeEditMode) {
            dismissibleRef.current.toggleModal()
        }
    }

    const closeEdition = (refKey, forceAction) => {
        dismissibleRef.current.closeModal(false, forceAction)
    }

    useEffect(() => {
        const watcherKey = v4()
        Backend.watchGoal(projectId, goalId, watcherKey, setGoal)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [])

    useEffect(() => {
        if (isActiveOrganizeMode) setShowingTasks(true)
    }, [isActiveOrganizeMode])

    const loggedUserIsGoalOwner = goal && loggedUserId === goal.ownerId
    const loggedUserCanUpdateObject =
        loggedUserIsGoalOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isLocked = objectIsLockedForUser(
        projectId,
        unlockedKeysByGuides,
        goal ? goal.lockKey : '',
        goal ? goal.ownerId : ''
    )

    const toggleTasksList = () => {
        setShowingTasks(state => !state)
    }

    // AT-2160: hides the goal row *and* the tasks under it, which is what the cascade will do
    // once the server transaction lands.
    if (hiddenByOptimisticPostpone) return null

    return (
        <View
            style={[
                containerStyle,
                isLocked &&
                    showingTasks &&
                    !isAnonymous && { minHeight: (smallScreenNavigation ? 332 : 258) + (editing ? 168 : 86) },
            ]}
        >
            {!isMiddleScreen && !smallScreenNavigation && (
                <GoalIndicator
                    inEditMode={editing}
                    dismissibleRef={dismissibleRef.current}
                    toggleTasksList={toggleTasksList}
                    showingTasks={showingTasks}
                />
            )}
            {goal && (
                <GoalItem
                    goal={goal}
                    projectId={projectId}
                    setDismissibleRefs={setDismissibleRefs}
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    isActiveOrganizeModeInTasks={isActiveOrganizeMode}
                    inParentGoal={true}
                    parentGoaltasks={taskList}
                    areObservedTask={isObservedTask}
                    refKey={`${goal.id}${dateIndex}${taskListIndex}${nestedTaskListIndex ? nestedTaskListIndex : ''}`}
                    setEditing={setEditing}
                    showingTasks={showingTasks}
                    toggleTasksList={toggleTasksList}
                    completedRunId={completedRunId}
                />
            )}
            {goal && showingTasks && (
                <View style={isLocked && localStyles.blurry} pointerEvents={isLocked ? 'none' : 'auto'}>
                    {loggedUserCanUpdateObject && inMainSection && !isTemplateProject ? (
                        isActiveOrganizeMode ? (
                            <SortModeActiveInfo containerStyle={{ paddingLeft: 8 }} />
                        ) : (
                            <NewTaskSection
                                projectId={projectId}
                                originalParentGoal={goal}
                                instanceKey={instanceKey}
                                dateIndex={dateIndex}
                                isLocked={isLocked}
                            />
                        )
                    ) : null}
                    <TasksList
                        projectId={projectId}
                        dateIndex={dateIndex}
                        subtaskByTask={subtaskByTask}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        taskList={taskList}
                        taskListIndex={taskListIndex}
                        isObservedTask={isObservedTask}
                        isToReviewTask={isToReviewTask}
                        isSuggested={isSuggested}
                        goalIndex={goalIndex}
                        amountToRender={amountToRender}
                        instanceKey={instanceKey}
                        inParentGoal={true}
                        focusedTaskId={focusedTaskId}
                    />
                    {loggedUserCanUpdateObject && inMainSection && isTemplateProject ? (
                        isActiveOrganizeMode ? (
                            <SortModeActiveInfo containerStyle={{ paddingLeft: 8 }} />
                        ) : (
                            <NewTaskSection
                                projectId={projectId}
                                originalParentGoal={goal}
                                instanceKey={instanceKey}
                                dateIndex={dateIndex}
                                expandTasksList={expandTasksList}
                                isLocked={isLocked}
                            />
                        )
                    ) : null}
                </View>
            )}
            {isLocked && !isAnonymous && showingTasks ? (
                <LockedGoalModal
                    projectId={projectId}
                    lockKey={goal.lockKey}
                    editing={editing}
                    goalId={goal.id}
                    ownerId={goal.ownerId}
                    tasks={taskList}
                    date={goal.assigneesReminderDate[currentUserId]}
                />
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    blurry: {
        filter: 'blur(3px)',
        userSelect: 'none',
    },
})
