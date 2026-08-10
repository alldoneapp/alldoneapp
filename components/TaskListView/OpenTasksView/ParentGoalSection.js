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
    const [goal, setGoal] = useState(null)
    const [editing, setEditing] = useState(false)
    const [showingTasks, setShowingTasks] = useState(true)
    const dismissibleRef = useRef(null)

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
