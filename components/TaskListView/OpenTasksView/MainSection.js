import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import {
    DATE_TASK_INDEX,
    EMPTY_SECTION_INDEX,
    MAIN_TASK_INDEX,
    NOT_PARENT_GOAL_INDEX,
    sortGoalTasksGorups,
    TODAY_DATE,
} from '../../../utils/backends/openTasks'
import ParentGoalSection from './ParentGoalSection'
import TasksList from './TasksList'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import {
    setShowMoreInMainSection,
    setTasksArrowButtonIsExpanded,
    hideFloatPopup,
    switchProject,
    setSelectedTypeOfProject,
    hideWebSideBar,
    setSelectedSidebarTab,
    setSelectedGoalDataInTasksListWhenAddTask,
    setAddTaskSectionToOpenData,
} from '../../../redux/actions'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import SharedHelper from '../../../utils/SharedHelper'
import store from '../../../redux/store'
import NewTaskSection from './NewTaskSection'
import EmptyGoal from './EmptyGoal'
import GeneralTasksHeader from './GeneralTasksHeader'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'
import SortModeActiveInfo from '../../GoalsView/SortModeActiveInfo'
import AssistantAddTaskInfo from './AssistantAddTaskInfo'
import { getGoalData, watchGoal } from '../../../utils/backends/Goals/goalsFirestore'
import { unwatch } from '../../../utils/backends/firestore'
import TasksHelper from '../Utils/TasksHelper'

export default function MainSection({
    projectId,
    dateIndex,
    isActiveOrganizeMode,
    projectIndex,
    instanceKey,
    pressedShowMoreMainSection,
    setPressedShowMoreMainSection,
}) {
    const dispatch = useDispatch()
    const dateFormated = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][DATE_TASK_INDEX])
    const mainTasks = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][MAIN_TASK_INDEX])
    const emptyGoalsAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][EMPTY_SECTION_INDEX].length
    )

    const thereAreHiddenNotMainTasks = useSelector(state =>
        state.thereAreHiddenNotMainTasks[instanceKey] ? state.thereAreHiddenNotMainTasks[instanceKey] : false
    )
    // Get calendar task info from the first day (if it exists)
    const hasOnlyCalendarTasks = useSelector(state => {
        if (!state.filteredOpenTasksStore[instanceKey] || !state.filteredOpenTasksStore[instanceKey][dateIndex])
            return false

        const firstDay = state.filteredOpenTasksStore[instanceKey][dateIndex]
        // If the day has calendar tasks but no other non-calendar tasks
        return (
            firstDay.hasCalendarTasks &&
            (firstDay.nonCalendarTasksCount === 0 || firstDay.nonCalendarTasksCount === undefined)
        )
    })
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const projectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const numberTodayTasks = useSelector(state => state.loggedUser.numberTodayTasks)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const isAssistant = useSelector(state => !!state.currentUser.temperature)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const showMoreInMainSection = useSelector(state => state.showMoreInMainSection)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const selectedGoalDataInTasksListWhenAddTask = useSelector(state => state.selectedGoalDataInTasksListWhenAddTask)
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const emptyGoals = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][EMPTY_SECTION_INDEX])
    const focusedTaskId = useSelector(state => state.loggedUser.inFocusTaskId)
    // Get optimistic focus task for immediate UI update before Firestore confirms
    const optimisticFocusTaskId = useSelector(state => state.optimisticFocusTaskId)
    const optimisticFocusTaskProjectId = useSelector(state => state.optimisticFocusTaskProjectId)
    const [tmpGoalsById, setTmpGoalsById] = useState({})

    const accessGranted = SharedHelper.checkIfUserHasAccessToProject(isAnonymous, projectIds, projectId, false)

    const expandTasks = () => {
        setTimeout(() => {
            const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
            if (inSelectedProject) {
                setPressedShowMoreMainSection(true)
            } else {
                const { currentUser } = store.getState()
                const projectType = ProjectHelper.getTypeOfProject(currentUser, projectId)
                dismissAllPopups(true, true, true)
                const actionsToDispatch = [
                    setTasksArrowButtonIsExpanded(true),
                    hideFloatPopup(),
                    setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                    switchProject(projectIndex),
                    setSelectedTypeOfProject(projectType),
                ]

                if (smallScreenNavigation) {
                    actionsToDispatch.push(hideWebSideBar())
                }
                dispatch(actionsToDispatch)
            }
        })
    }

    const contractTasks = () => {
        setPressedShowMoreMainSection(false)
        dispatch(setShowMoreInMainSection(false))
    }

    const isMainDay = dateFormated === TODAY_DATE

    const getMainItemsData = () => {
        let mainItemsAmount = emptyGoalsAmount
        mainTasks.forEach(goalTasksData => {
            mainItemsAmount += goalTasksData[1].length
        })

        const showMainListShowMore =
            isMainDay && !isActiveOrganizeMode && numberTodayTasks > 0 && numberTodayTasks < mainItemsAmount

        return { mainItemsAmount, showMainListShowMore }
    }

    const updateTmpGoal = (goalId, goal) => {
        if (goal) {
            setTmpGoalsById(state => {
                return { ...state, [goalId]: goal }
            })
        } else {
            unwatch(goalId)
            setTmpGoalsById(state => {
                const newState = { ...state }
                delete newState[goalId]
                return newState
            })
        }
    }

    useEffect(() => {
        const tmpGoalIdsToRemove = []
        const goalsData = [...emptyGoals, ...mainTasks]
        for (let i = 0; i < goalsData.length; i++) {
            const goalId = goalsData[i].id || goalsData[i][0]
            if (tmpGoalsById[goalId]) {
                unwatch(goalId)
                tmpGoalIdsToRemove.push(goalId)
            }
        }

        setTmpGoalsById(state => {
            const newState = { ...state }
            tmpGoalIdsToRemove.forEach(goalId => {
                delete newState[goalId]
            })
            return newState
        })
    }, [mainTasks, emptyGoals])

    useEffect(() => {
        return () => {
            for (const goalId in tmpGoalsById) {
                unwatch(goalId)
            }
        }
    }, [])

    const processSelectedGoalForAddTask = async selectedGoalDataInTasksListWhenAddTask => {
        const {
            projectId: goalProjectId,
            goal,
            dateFormated: goalDateFormated,
            isNewGoal,
        } = selectedGoalDataInTasksListWhenAddTask
        if (projectId === goalProjectId && dateFormated === goalDateFormated) {
            if (isNewGoal) {
                setTimeout(() => {
                    dispatch(setAddTaskSectionToOpenData({ projectId, goalId: goal.id, dateFormated }))
                }, 1000)
            } else if (goal) {
                let goalAlreadyExist = false

                const goalsData = [...emptyGoals, ...mainTasks]
                for (let i = 0; i < goalsData.length; i++) {
                    const goalId = goalsData[i].id || goalsData[i][0]
                    if (goal.id === goalId) {
                        goalAlreadyExist = true
                        break
                    }
                }

                if (!goalAlreadyExist) {
                    const fullGoal = await getGoalData(projectId, goal.id)
                    if (fullGoal) {
                        setTmpGoalsById(state => {
                            return { ...state, [fullGoal.id]: fullGoal }
                        })
                        watchGoal(projectId, fullGoal.id, fullGoal.id, tmpGoal => {
                            updateTmpGoal(fullGoal.id, tmpGoal)
                        })
                    }
                }

                dispatch(setAddTaskSectionToOpenData({ projectId, goalId: goal.id, dateFormated }))
            } else {
                dispatch(setAddTaskSectionToOpenData({ projectId, goalId: '', dateFormated }))
            }
            dispatch(setSelectedGoalDataInTasksListWhenAddTask(null))
        }
    }

    useEffect(() => {
        if (selectedGoalDataInTasksListWhenAddTask)
            processSelectedGoalForAddTask(selectedGoalDataInTasksListWhenAddTask)
    }, [selectedGoalDataInTasksListWhenAddTask])

    useEffect(() => {
        if (!!showMoreInMainSection) expandTasks()
        return () => {
            if (!!showMoreInMainSection && showMoreInMainSection === currentUserId)
                dispatch(setShowMoreInMainSection(false))
        }
    }, [])

    const tmpGoals = Object.values(tmpGoalsById)

    const { mainItemsAmount, showMainListShowMore } = getMainItemsData()
    const showTheFullList = !showMainListShowMore || pressedShowMoreMainSection
    let globalAmountToRender = showTheFullList ? mainItemsAmount + tmpGoals.length : numberTodayTasks

    const goalsPositionId = sortGoalTasksGorups(projectId, openMilestones, doneMilestones, goalsById, currentUserId, [
        ...mainTasks,
        ...emptyGoals.map(goal => [goal.id]),
        ...tmpGoals.map(goal => [goal.id]),
    ])

    if (!goalsPositionId) return null

    let sortedMainTasks = [
        ...mainTasks,
        ...emptyGoals.map(goal => [goal.id, goal]),
        ...tmpGoals.map(goal => [goal.id, goal]),
    ]

    // Separate valid and orphaned tasks
    const validTasks = []
    const orphanedTasks = []

    sortedMainTasks.forEach((data, index) => {
        const goalId = data[0]
        const hasPosition = goalsPositionId[goalId] !== undefined

        if (hasPosition) {
            validTasks.push(data)
        } else {
            // For orphaned tasks, we need to extract the individual tasks
            const taskList = data[1]
            if (Array.isArray(taskList)) {
                // This is a regular task group, add all tasks to orphaned list
                orphanedTasks.push(...taskList)
            }
        }
    })

    // If we have orphaned tasks, create or merge into a general tasks group without mutating existing arrays
    if (orphanedTasks.length > 0) {
        const existingGeneralIndex = validTasks.findIndex(data => data[0] === NOT_PARENT_GOAL_INDEX)

        if (existingGeneralIndex >= 0) {
            const currentGeneralTasks = validTasks[existingGeneralIndex][1] || []
            // Replace the tuple to avoid mutating the original tasks array reference
            validTasks[existingGeneralIndex] = [NOT_PARENT_GOAL_INDEX, [...currentGeneralTasks, ...orphanedTasks]]
        } else {
            // Create new general tasks group with a fresh array reference
            validTasks.push([NOT_PARENT_GOAL_INDEX, [...orphanedTasks]])
        }
    }

    sortedMainTasks = validTasks

    sortedMainTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    // --- Start: Focus logic ---
    // Use optimistic focus task ID if it's in this project, otherwise use the confirmed focusedTaskId
    const effectiveFocusTaskId =
        optimisticFocusTaskId && optimisticFocusTaskProjectId === projectId ? optimisticFocusTaskId : focusedTaskId

    let focusedTaskSectionId = null
    if (effectiveFocusTaskId) {
        // Check mainTasks for goals AND general tasks
        for (const goalTasksData of mainTasks) {
            const goalId = goalTasksData[0]
            const taskList = goalTasksData[1]
            if (taskList.some(task => task.id === effectiveFocusTaskId)) {
                focusedTaskSectionId = goalId // This will be NOT_PARENT_GOAL_INDEX for general tasks
                break
            }
        }
        // Check emptyGoals if necessary (Task might be an empty goal itself? Unlikely focus target)
        // if (!focusedTaskSectionId) { ... }
        // Check tmpGoals if necessary
        // if (!focusedTaskSectionId) { ... }
    }

    if (focusedTaskSectionId) {
        const focusedSectionIndex = sortedMainTasks.findIndex(data => data[0] === focusedTaskSectionId)
        if (focusedSectionIndex > 0) {
            // Move focused section to the top
            const [focusedSection] = sortedMainTasks.splice(focusedSectionIndex, 1)
            sortedMainTasks.unshift(focusedSection)
        }
    }
    // --- End: Focus logic ---

    const isTemplateProject = templateProjectIds.includes(projectId)
    let amountOfTasksWithoutParent = 0

    // Check if there are any actual goals besides the general tasks section
    const hasGoals = sortedMainTasks.some(data => data[0] !== NOT_PARENT_GOAL_INDEX)

    const loggedUserIsBoardOwner = loggedUserId === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={localStyles.container}>
            {sortedMainTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const isEmptyGoal = !!goalTasksData[1].id
                const lastItem = sortedMainTasks.length - 1 === index

                if (isEmptyGoal) {
                    // --- Render Empty Goal ---
                    const goal = goalTasksData[1]
                    const amountToRenderForEmptyGoal = globalAmountToRender > 1 ? 1 : globalAmountToRender
                    if (amountToRenderForEmptyGoal <= 0 && !showTheFullList) return null // Adjusted condition for amountToRender
                    globalAmountToRender = globalAmountToRender > 1 ? globalAmountToRender - 1 : 0

                    return (
                        <EmptyGoal
                            key={goal.id}
                            goal={goal}
                            projectId={projectId}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            dateIndex={dateIndex}
                            instanceKey={instanceKey}
                            containerStyle={{ marginBottom: lastItem || globalAmountToRender === 0 ? 0 : 32 }}
                        />
                    )
                } else if (goalId === NOT_PARENT_GOAL_INDEX) {
                    // --- Render General Tasks Section ---
                    const taskList = goalTasksData[1]
                    amountOfTasksWithoutParent = taskList.length // Track amount for Add Task button logic
                    const amountToRenderForGeneral = showTheFullList
                        ? taskList.length
                        : globalAmountToRender > taskList.length
                        ? taskList.length
                        : globalAmountToRender

                    // Don't render the section if no tasks are visible unless it's the only section
                    if (amountToRenderForGeneral <= 0 && sortedMainTasks.length > 1 && !showTheFullList) return null

                    globalAmountToRender =
                        globalAmountToRender > taskList.length ? globalAmountToRender - taskList.length : 0

                    const goalIndex = mainTasks.findIndex(data => data[0] === NOT_PARENT_GOAL_INDEX)

                    return (
                        <View key={goalId} style={{ marginBottom: lastItem || globalAmountToRender === 0 ? 0 : 32 }}>
                            {/* Render header only if other goals exist */}
                            {hasGoals && (
                                <SwipeableGeneralTasksHeader
                                    projectId={projectId}
                                    taskList={taskList}
                                    dateIndex={dateIndex}
                                    instanceKey={instanceKey}
                                />
                            )}
                            {accessGranted &&
                                loggedUserCanUpdateObject &&
                                !isTemplateProject &&
                                (isAssistant ? (
                                    <AssistantAddTaskInfo containerStyle={{ paddingLeft: 8 }} />
                                ) : isActiveOrganizeMode ? (
                                    <SortModeActiveInfo containerStyle={{ paddingLeft: 8 }} />
                                ) : (
                                    <NewTaskSection
                                        projectId={projectId}
                                        originalParentGoal={null}
                                        instanceKey={instanceKey}
                                        dateIndex={dateIndex}
                                    />
                                ))}
                            <TasksList
                                projectId={projectId}
                                dateIndex={dateIndex}
                                isActiveOrganizeMode={isActiveOrganizeMode}
                                taskList={taskList}
                                taskListIndex={MAIN_TASK_INDEX}
                                goalIndex={goalIndex}
                                amountToRender={amountToRenderForGeneral}
                                instanceKey={instanceKey}
                                inParentGoal={false}
                                focusedTaskId={effectiveFocusTaskId}
                            />
                            {accessGranted &&
                                loggedUserCanUpdateObject &&
                                isTemplateProject &&
                                (isAssistant ? (
                                    <AssistantAddTaskInfo containerStyle={{ paddingLeft: 8 }} />
                                ) : isActiveOrganizeMode ? (
                                    <SortModeActiveInfo containerStyle={{ paddingLeft: 8 }} />
                                ) : (
                                    <NewTaskSection
                                        projectId={projectId}
                                        originalParentGoal={null}
                                        instanceKey={instanceKey}
                                        dateIndex={dateIndex}
                                        expandTasksList={
                                            isMainDay &&
                                            isTemplateProject &&
                                            loggedUserId === currentUserId &&
                                            globalAmountToRender <= 0 // Adjusted condition
                                                ? expandTasks
                                                : undefined
                                        }
                                        focusedTaskId={effectiveFocusTaskId}
                                    />
                                ))}
                        </View>
                    )
                } else {
                    // --- Render Parent Goal Section ---
                    const goalIndex = mainTasks.findIndex(data => data[0] === goalId)
                    const taskList = goalTasksData[1]
                    const amountToRenderForGoal = showTheFullList
                        ? taskList.length
                        : globalAmountToRender > taskList.length
                        ? taskList.length
                        : globalAmountToRender

                    if (amountToRenderForGoal <= 0 && !showTheFullList) return null // Adjusted condition for amountToRender

                    globalAmountToRender =
                        globalAmountToRender > taskList.length ? globalAmountToRender - taskList.length : 0

                    return (
                        <ParentGoalSection
                            key={goalId}
                            projectId={projectId}
                            dateIndex={dateIndex}
                            goalId={goalId}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            taskList={taskList}
                            taskListIndex={MAIN_TASK_INDEX}
                            containerStyle={{ marginBottom: lastItem || globalAmountToRender === 0 ? 0 : 32 }}
                            inMainSection={accessGranted}
                            goalIndex={goalIndex}
                            amountToRender={amountToRenderForGoal}
                            instanceKey={instanceKey}
                            expandTasksList={
                                isMainDay &&
                                isTemplateProject &&
                                loggedUserId === currentUserId &&
                                globalAmountToRender <= 0
                                    ? expandTasks
                                    : undefined
                            }
                            isTemplateProject={isTemplateProject}
                            focusedTaskId={effectiveFocusTaskId}
                        />
                    )
                }
            })}

            {/* Render Add Task section if the list is completely empty */}
            {sortedMainTasks.length === 0 &&
                accessGranted &&
                loggedUserCanUpdateObject &&
                !isTemplateProject &&
                !isAssistant &&
                !isActiveOrganizeMode && (
                    <NewTaskSection
                        projectId={projectId}
                        originalParentGoal={null} // Add to general tasks
                        instanceKey={instanceKey}
                        dateIndex={dateIndex}
                    />
                )}

            {/* Only show the down arrow if we have more tasks to show or there are hidden tasks (not just calendar-only days) */}
            {(showMainListShowMore || (thereAreHiddenNotMainTasks && !hasOnlyCalendarTasks)) && (
                <ShowMoreButton
                    expanded={pressedShowMoreMainSection}
                    contract={contractTasks}
                    expand={expandTasks}
                    style={{ marginBottom: 0 }}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
})
