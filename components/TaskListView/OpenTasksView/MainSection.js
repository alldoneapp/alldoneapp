import React, { useEffect, useRef, useState } from 'react'
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
import { getGoalData, watchGoal } from '../../../utils/backends/Goals/goalsFirestore'
import { unwatch } from '../../../utils/backends/firestore'
import TasksHelper from '../Utils/TasksHelper'
import { useIsUserEditing } from '../../../utils/editingGuard'
import { createSectionRenderBudget } from './sectionRenderBudget'
import { pinSectionToTop, resolvePinnedSectionId } from './focusSectionPin'
import { holdTaskGrouping } from './taskPlacementHold'
import useGoalSectionExit from './useGoalSectionExit'

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
    // While the user is typing, background snapshots must not restructure what
    // is already on screen: a section that unmounts takes the open editor (and
    // the typed text) with it, and a section that merely *moves* blurs the
    // focused input. See utils/editingGuard.js.
    const isUserEditing = useIsUserEditing()
    // Last section render sizes observed while the user was NOT editing. Used
    // as a floor during editing so no mounted section can drop out.
    const renderedAmountsRef = useRef({})
    // Section pinned to the top by the focus task in the last idle render, held
    // across renders so an opening editor cannot un-pin it. See focusSectionPin.js.
    const pinnedSectionRef = useRef(undefined)
    // Which goal section each already-mounted task was rendered in, held while
    // the user types so a background `parentGoalId` write cannot re-bucket the
    // row and unmount the open editor with it (AT-2267). See taskPlacementHold.js.
    const taskGroupingRef = useRef(undefined)
    const dateFormated = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][DATE_TASK_INDEX])
    const liveMainTasks = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][MAIN_TASK_INDEX])
    const heldMainTasks = holdTaskGrouping(liveMainTasks, isUserEditing, taskGroupingRef)
    const emptyGoalsAmount = useSelector(
        state => state.filteredOpenTasksStore[instanceKey][dateIndex][EMPTY_SECTION_INDEX].length
    )

    const thereAreHiddenNotMainTasks = useSelector(state =>
        state.thereAreHiddenNotMainTasks[instanceKey] ? state.thereAreHiddenNotMainTasks[instanceKey] : false
    )
    // AT-2377: a day whose only tasks are meetings hides nothing - the Calendar section always
    // renders them in full - so the "show more" arrow must not appear for it.
    const hasOnlyCalendarTasks = useSelector(state => {
        const day = state.filteredOpenTasksStore[instanceKey]?.[dateIndex]
        if (!day) return false
        return Boolean(day.hasCalendarTasks) && !day.nonCalendarTasksCount
    })
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const projectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const numberTodayTasks = useSelector(state => state.loggedUser.numberTodayTasks)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const isAssistant = useSelector(state => !!state.currentUser.temperature)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const showMoreInMainSection = useSelector(state => state.showMoreInMainSection)
    // AT-2507 — the same two slices `OpenTasksByProject` reads for the per-project sweep's filter
    // gate. `shallowEqual` because both are arrays the reducer replaces wholesale.
    const taskPriorityFilters = useSelector(state => state.taskPriorityFilters, shallowEqual)
    const taskVmStateFilters = useSelector(state => state.taskVmStateFilters, shallowEqual)
    const taskFiltersActive = taskPriorityFilters.length > 0 || taskVmStateFilters.length > 0
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
    const optimisticFocusGoalId = useSelector(state => state.optimisticFocusGoalId)
    const optimisticFocusActive = useSelector(state => state.optimisticFocusActive)
    const [tmpGoalsById, setTmpGoalsById] = useState({})
    const tmpGoalsByIdRef = React.useRef({})

    const accessGranted = SharedHelper.checkIfUserHasAccessToProject(isAnonymous, projectIds, projectId, false)

    /**
     * AT-2507 — may a goal section on this list leave gracefully instead of popping?
     *
     * Each gate closes a way of animating a departure that is not the one being fixed, and they
     * mirror the per-project gates in `OpenTasksByProject` one scope down:
     *
     *   • TODAY only. The reported behaviour is about today's list, and with Later expanded several
     *     day sections are on screen at once.
     *   • No task filters. This whole list comes from `filteredOpenTasksStore`, so with a priority
     *     or VM filter on, "every task the section had" means "every task the filter let through" —
     *     completing the one visible task of a goal that still has three hidden ones must not be
     *     read as the goal's work being finished. (A filter also removes goals through this very
     *     code path, and none of those departures is an achievement.)
     *   • The board is the logged user's own, and not an assistant profile board.
     *   • Not while organising, where sections are being dragged rather than worked.
     *
     * The lists that do NOT get this are as deliberate: only `MainSection` passes an `exitRunId`,
     * so the observed / mention / suggested / originally-from lists — which group by goal through
     * the same `ParentGoalSection` — keep today's instant removal. Finishing every task somebody
     * else is observing under a goal is not the same event.
     */
    const goalSectionExitEnabled =
        dateFormated === TODAY_DATE &&
        accessGranted &&
        !isActiveOrganizeMode &&
        !isAssistant &&
        !isAnonymous &&
        !taskFiltersActive &&
        loggedUserId === currentUserId

    const { mainTasksWithExits, exitRunIdByGoalId } = useGoalSectionExit({
        projectId,
        mainTasks: heldMainTasks,
        emptyGoals,
        enabled: goalSectionExitEnabled,
    })
    // Everything downstream — the counts, the sort, the render — treats a leaving section as an
    // ordinary (empty) one, so nothing else in this component needs to know about the hold.
    const mainTasks = mainTasksWithExits

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

    const addTmpGoal = goal => {
        if (tmpGoalsByIdRef.current[goal.id]) unwatch(goal.id)
        setTmpGoalsById(state => {
            return { ...state, [goal.id]: goal }
        })
        watchGoal(projectId, goal.id, goal.id, tmpGoal => {
            updateTmpGoal(goal.id, tmpGoal)
        })
    }

    useEffect(() => {
        tmpGoalsByIdRef.current = tmpGoalsById
    }, [tmpGoalsById])

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
            for (const goalId in tmpGoalsByIdRef.current) {
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
                addTmpGoal(goal)
                dispatch(setAddTaskSectionToOpenData({ projectId, goalId: goal.id, dateFormated }))
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
                        addTmpGoal(fullGoal)
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

    // A task held in the goal section it was rendered in (AT-2267) keeps that
    // section populated, while the live snapshot already reports the goal as
    // having no tasks and therefore lists it among the empty goals. Rendering
    // both would show the same goal twice, so the held section wins until the
    // next idle render puts everything back in sync.
    const heldSectionIds = heldMainTasks === liveMainTasks ? null : new Set(mainTasks.map(([sectionId]) => sectionId))
    const visibleEmptyGoals = heldSectionIds ? emptyGoals.filter(goal => !heldSectionIds.has(goal.id)) : emptyGoals

    const { mainItemsAmount, showMainListShowMore } = getMainItemsData()
    const showTheFullList = !showMainListShowMore || pressedShowMoreMainSection
    let globalAmountToRender = showTheFullList ? mainItemsAmount + tmpGoals.length : numberTodayTasks
    const goalsByIdWithTmpGoals = { ...goalsById, ...tmpGoalsById }

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsByIdWithTmpGoals,
        currentUserId,
        [...mainTasks, ...visibleEmptyGoals.map(goal => [goal.id]), ...tmpGoals.map(goal => [goal.id])]
    )

    if (!goalsPositionId) return null

    const lastGoalPosition = Math.max(...Object.values(goalsPositionId))
    tmpGoals.forEach((goal, index) => {
        if (goalsPositionId[goal.id] === undefined) {
            goalsPositionId[goal.id] = lastGoalPosition + index + 1
        }
    })

    let sortedMainTasks = [
        ...mainTasks,
        ...visibleEmptyGoals.map(goal => [goal.id, goal]),
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
    // When optimistic state is active for this project, use it (even if taskId is null, meaning "no task focused yet")
    // Only fall back to Firestore's focusedTaskId when optimistic state is not active
    const effectiveFocusTaskId =
        optimisticFocusActive && optimisticFocusTaskProjectId === projectId ? optimisticFocusTaskId : focusedTaskId

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

    // Fallback: if no task-based section found, use optimistic goal ID to keep the goal pinned
    if (!focusedTaskSectionId && optimisticFocusGoalId && optimisticFocusTaskProjectId === projectId) {
        focusedTaskSectionId = optimisticFocusGoalId
    }

    // Pinning the focused section to the top reorders the keyed section list.
    // React handles that by MOVING the existing DOM nodes, and moving a node
    // blurs whatever is focused inside it - so a background change to
    // `inFocusTaskId` must not yank the caret out of an open editor. While the
    // user edits we therefore hold the last pin decision taken while idle
    // instead of dropping it: an already pinned section stays pinned (AT-2249),
    // a *new* pin waits for the next idle render (AT-2203). See focusSectionPin.js.
    pinSectionToTop(sortedMainTasks, resolvePinnedSectionId(focusedTaskSectionId, isUserEditing, pinnedSectionRef))
    // --- End: Focus logic ---

    const isTemplateProject = templateProjectIds.includes(projectId)
    let amountOfTasksWithoutParent = 0

    // Check if there are any actual goals besides the general tasks section
    const hasGoals = sortedMainTasks.some(data => data[0] !== NOT_PARENT_GOAL_INDEX)

    const loggedUserIsBoardOwner = loggedUserId === currentUserId
    const loggedUserCanUpdateObject =
        loggedUserIsBoardOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    // Holds already-mounted sections at their last idle size while the user is
    // typing, so a background task cannot starve one out of the shared budget
    // and unmount an open editor. See sectionRenderBudget.js.
    const sectionBudget = createSectionRenderBudget(isUserEditing, renderedAmountsRef)

    return (
        <View style={localStyles.container}>
            {sortedMainTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const isEmptyGoal = !!goalTasksData[1].id
                const lastItem = sortedMainTasks.length - 1 === index

                if (isEmptyGoal) {
                    // --- Render Empty Goal ---
                    const goal = goalTasksData[1]
                    const amountToRenderForEmptyGoal = sectionBudget.resolve(
                        goal.id,
                        globalAmountToRender > 1 ? 1 : globalAmountToRender
                    )
                    if (sectionBudget.shouldSkip(goal.id, amountToRenderForEmptyGoal, !showTheFullList)) return null // Adjusted condition for amountToRender
                    sectionBudget.remember(goal.id, amountToRenderForEmptyGoal)
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
                    const amountToRenderForGeneral = sectionBudget.resolve(
                        goalId,
                        showTheFullList
                            ? taskList.length
                            : globalAmountToRender > taskList.length
                              ? taskList.length
                              : globalAmountToRender
                    )

                    // Don't render the section if no tasks are visible unless it's the only section
                    if (
                        sectionBudget.shouldSkip(
                            goalId,
                            amountToRenderForGeneral,
                            sortedMainTasks.length > 1 && !showTheFullList
                        )
                    )
                        return null

                    sectionBudget.remember(goalId, amountToRenderForGeneral)

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
                                !isAssistant &&
                                (isActiveOrganizeMode ? (
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
                                !isAssistant &&
                                (isActiveOrganizeMode ? (
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
                    const amountToRenderForGoal = sectionBudget.resolve(
                        goalId,
                        showTheFullList
                            ? taskList.length
                            : globalAmountToRender > taskList.length
                              ? taskList.length
                              : globalAmountToRender
                    )

                    // AT-2507 — a section playing its departure carries no tasks, so the budget
                    // would skip it on any truncated list and the exit would never be seen. See
                    // `sectionRenderBudget.shouldSkip` for why leaving is a carve-out there.
                    const exitRunId = exitRunIdByGoalId[goalId] || 0
                    if (
                        sectionBudget.shouldSkip(goalId, amountToRenderForGoal, !showTheFullList, {
                            leaving: !!exitRunId,
                        })
                    )
                        return null // Adjusted condition for amountToRender

                    sectionBudget.remember(goalId, amountToRenderForGoal)

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
                            exitRunId={exitRunId}
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

            {/* Only show the down arrow if we have more tasks to show or there are hidden tasks */}
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
