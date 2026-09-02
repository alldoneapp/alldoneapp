import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector, shallowEqual, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import ProjectHeader from '../Header/ProjectHeader'
import OpenTasksByDate from '../OpenTasksView/OpenTasksByDate'
import { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import {
    AMOUNT_TASKS_INDEX,
    DATE_TASK_INDEX,
    TODAY_DATE,
    watchAllGoals,
    watchAllMilestones,
} from '../../../utils/backends/openTasks'
import NeedShowMoreOpenTasksButton from './NeedShowMoreOpenTasksButton'
import OpenTasksByProjectHandler from './OpenTasksByProjectHandler'
import BottomShowMoreButtonContainer from './BottomShowMoreButtonContainer'
import Backend from '../../../utils/BackendBridge'
import { setTasksArrowButtonIsExpanded } from '../../../redux/actions'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import { useProjectAssistantLine } from '../../MyDayView/AssistantLine/useAssistantLineSwitch'
import OKRSection from '../OKRs/OKRSection'
import UpcomingMilestoneRow from '../Header/UpcomingMilestoneRow'
import TaskFiltersLine from '../PriorityFilters/TaskFiltersLine'
import { watchProjectOKRs } from '../../../utils/backends/OKRs/okrsFirestore'
import { getOkrAllProjectsTodayKey, getOkrUserTimezone } from '../OKRs/okrHelper'
import AssistantScheduleDateSection from './OpenTaskViewForAssistants/AssistantScheduleTimeline'
import { buildAssistantProfileTimelineDates } from '../../../utils/assistantSchedule'
import TaskListSkeleton from '../TaskListSkeleton'
import useProjectCompletedSweep from './useProjectCompletedSweep'

function OpenTasksByProject({
    firstProject,
    setProjectsHaveTasksInFirstDay,
    sortedLoggedUserProjectIds,
    projectId,
    assistantProfileMode = false,
    assistantScheduleOccurrences = [],
    assistantScheduleContext = null,
    assistantTaskCreatorContext = null,
    taskWatchersEnabled = true,
}) {
    const dispatch = useDispatch()
    const projectIndex = useSelector(state => state.loggedUserProjectsMap[projectId]?.index)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const loggedUser = useSelector(state => state.loggedUser)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const isAssistant = useSelector(state => !!state.currentUser.temperature)
    const tasksArrowButtonIsExpanded = useSelector(state => state.tasksArrowButtonIsExpanded)
    const okrsInProject = useSelector(state => state.okrsByProjectInTasks[projectId] || [])
    const [pressedShowMoreMainSection, setPressedShowMoreMainSection] = useState(false)

    const instanceKey = projectId + currentUserId

    const filteredOpenTasks = useSelector(state => state.filteredOpenTasksStore[instanceKey] || [], shallowEqual)
    const taskPriorityFilters = useSelector(state => state.taskPriorityFilters, shallowEqual)
    const taskVmStateFilters = useSelector(state => state.taskVmStateFilters, shallowEqual)
    const filteredOpenTasksDates = filteredOpenTasks.map(tasksByDate => tasksByDate[DATE_TASK_INDEX])
    const initialLoadingEndOpenTasks = useSelector(state => !!state.initialLoadingEndOpenTasks?.[instanceKey])
    const initialLoadingEndObservedTasks = useSelector(state => !!state.initialLoadingEndObservedTasks?.[instanceKey])
    const singleTaskIsLoading = useSelector(state => !!state.taskListSingleLoading?.[instanceKey])
    const assistantProfileTimelineDates = assistantProfileMode
        ? buildAssistantProfileTimelineDates(filteredOpenTasksDates, assistantScheduleOccurrences)
        : filteredOpenTasksDates.map((dateKey, dateIndex) => ({ dateKey, dateIndex, occurrences: [] }))
    const thereAreNotTasksInFirstDay = useSelector(state =>
        state.thereAreNotTasksInFirstDay[instanceKey] ? state.thereAreNotTasksInFirstDay[instanceKey] : false
    )

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    const todayKey = getOkrAllProjectsTodayKey(undefined, getOkrUserTimezone(loggedUser))
    const okrsHiddenTodayById = loggedUser.okrsHiddenInAllProjectsTodayByProjectAndOkr?.[projectId] || {}
    const visibleOkrsInAllProjects = okrsInProject.filter(okr => okrsHiddenTodayById[okr.id] !== todayKey)
    const taskFiltersActive = taskPriorityFilters.length > 0 || taskVmStateFilters.length > 0
    const hasMatchingFilteredTasks = filteredOpenTasks.some(section => section[AMOUNT_TASKS_INDEX] > 0)
    const hideProjectWithoutFilterMatches = !inSelectedProject && taskFiltersActive && !hasMatchingFilteredTasks
    const baseHideProjectData =
        hideProjectWithoutFilterMatches ||
        (!inSelectedProject &&
            visibleOkrsInAllProjects.length === 0 &&
            (thereAreNotTasksInFirstDay || filteredOpenTasksDates.length == 0))

    /**
     * AT-2492 — who may spend the once-per-day, per-project "completed sweep".
     *
     * The gates moved up here from `OpenTasksByDate` together with the celebration itself, and one
     * of them is gone: the sweep is no longer restricted to the selected-project board, because the
     * project line exists in All Projects too and clearing a project there is the ordinary case.
     * What is left closes the remaining ways of celebrating something that did not happen:
     *
     *   • no task filters. `thereAreNotTasksInFirstDay` and the filtered store both describe a
     *     FILTERED list, so a priority or VM filter empties a project on screen without the project
     *     being done. (The marker records are keyed on the unfiltered `sidebarNumbers` count, so
     *     this is belt and braces rather than the only defence.)
     *   • the board is the logged user's own — an assistant's board is not your inbox;
     *   • not an assistant profile board, which renders no project header at all;
     *   • not anonymous.
     *
     * Two more gates live inside the hook and are the load-bearing ones: the project must actually
     * have gone from "has tasks today" to "clear" TODAY (otherwise a 78-project account, 64 of them
     * guides and empty most days, sweeps on every visit), and its line must actually be on screen.
     */
    const celebrationEnabled =
        !assistantProfileMode && !isAnonymous && !taskFiltersActive && currentUserId === loggedUser.uid

    const { celebrationRunId, holdProjectLine } = useProjectCompletedSweep({
        projectId,
        userId: loggedUser.uid,
        enabled: celebrationEnabled,
        lineWouldLeave: baseHideProjectData,
    })

    // The only thing the celebration is allowed to change about the board: a line that is leaving
    // stays for one sweep and then goes. The settled result is identical either way.
    const hideProjectData = baseHideProjectData && !holdProjectLine

    // AT-2430: which assistant this project's line speaks as — the project's own, the default
    // project's, or one the user picked with the line's switch — plus the switch's own options.
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    // All Projects already owns one global assistant line. Passing every preloaded project into
    // this hook armed an assistant collection watcher even though its line could never render.
    const { hasAssistantLine, assistantLineProps } = useProjectAssistantLine(inSelectedProject ? project : null)
    const showAssistantLine = !assistantProfileMode && !isAnonymous && inSelectedProject && hasAssistantLine
    const projectDecorationsReady =
        taskWatchersEnabled &&
        (inSelectedProject ||
            (initialLoadingEndOpenTasks && initialLoadingEndObservedTasks) ||
            ((initialLoadingEndOpenTasks || initialLoadingEndObservedTasks) && hasMatchingFilteredTasks))
    const showInitialSkeleton =
        inSelectedProject &&
        filteredOpenTasksDates.length === 0 &&
        !singleTaskIsLoading &&
        (!initialLoadingEndOpenTasks || !initialLoadingEndObservedTasks)
    const showSingleTaskSkeleton = singleTaskIsLoading && filteredOpenTasksDates.length === 0

    useEffect(() => {
        if (!projectDecorationsReady) return undefined
        const watcherKey = v4()
        watchAllMilestones(projectId, watcherKey)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [projectDecorationsReady, projectId])

    useEffect(() => {
        if (!projectDecorationsReady) return undefined
        const watcherKey = v4()
        watchAllGoals(projectId, watcherKey)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [projectDecorationsReady, projectId])

    useEffect(() => {
        if (!projectDecorationsReady) return undefined
        const watcherKey = v4()
        watchProjectOKRs(projectId, currentUserId, watcherKey)
        return () => {
            Backend.unwatch(watcherKey)
        }
    }, [currentUserId, projectDecorationsReady, projectId])

    useEffect(() => {
        if (currentUserId) {
            setPressedShowMoreMainSection(tasksArrowButtonIsExpanded)
            if (tasksArrowButtonIsExpanded) {
                dispatch(setTasksArrowButtonIsExpanded(false))
            }
        }
    }, [currentUserId, projectId])

    return (
        <>
            <OpenTasksByProjectHandler
                projectIndex={projectIndex}
                firstProject={firstProject}
                setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                assistantProfileMode={assistantProfileMode}
                taskWatchersEnabled={taskWatchersEnabled}
            />
            {!hideProjectData && (
                <View style={{ marginBottom: inSelectedProject ? 32 : 25 }}>
                    {inSelectedProject && <NeedShowMoreOpenTasksButton projectId={projectId} />}
                    {!assistantProfileMode && (
                        <ProjectHeader
                            projectIndex={projectIndex}
                            projectId={projectId}
                            showWorkflowTag={!isAssistant}
                            showAddTask={!isAssistant}
                            setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                            showRootSectionNavigation={inSelectedProject}
                            showEmailLabels={!isAssistant}
                            completedSweepRunId={celebrationRunId}
                        />
                    )}
                    {showAssistantLine && (
                        <View style={{ marginTop: 0 }}>
                            <AssistantLine {...assistantLineProps} />
                        </View>
                    )}
                    {inSelectedProject && !isAssistant && <TaskFiltersLine projectId={projectId} />}
                    {!assistantProfileMode && <OKRSection projectId={projectId} inAllProjects={!inSelectedProject} />}
                    {!assistantProfileMode && <UpcomingMilestoneRow projectId={projectId} />}
                    {showInitialSkeleton && <TaskListSkeleton showDateHeader />}
                    {showSingleTaskSkeleton && <TaskListSkeleton rowCount={1} />}
                    {assistantProfileTimelineDates.map((timelineDate, timelineIndex) => {
                        return timelineDate.dateIndex !== null ? (
                            <OpenTasksByDate
                                key={timelineDate.dateKey}
                                projectId={projectId}
                                projectIndex={projectIndex}
                                dateIndex={timelineDate.dateIndex}
                                instanceKey={instanceKey}
                                sortedLoggedUserProjectIds={sortedLoggedUserProjectIds}
                                setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                                pressedShowMoreMainSection={pressedShowMoreMainSection}
                                setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                                assistantProfileMode={assistantProfileMode}
                                assistantScheduleOccurrences={timelineDate.occurrences}
                                assistantScheduleContext={assistantScheduleContext}
                                projectCelebrationRunId={celebrationRunId}
                                assistantTaskCreatorContext={
                                    assistantProfileMode && timelineDate.dateKey === TODAY_DATE
                                        ? assistantTaskCreatorContext
                                        : null
                                }
                            />
                        ) : (
                            <AssistantScheduleDateSection
                                key={timelineDate.dateKey}
                                projectId={projectId}
                                dateKey={timelineDate.dateKey}
                                occurrences={timelineDate.occurrences}
                                firstDateSection={timelineIndex === 0}
                                {...assistantScheduleContext}
                            />
                        )
                    })}
                    {inSelectedProject && (
                        <BottomShowMoreButtonContainer
                            instanceKey={instanceKey}
                            projectIndex={projectIndex}
                            setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                        />
                    )}
                </View>
            )}
        </>
    )
}

/**
 * AT-2337: "All projects" renders one of these per project - 78 on a heavy
 * dogfooding account. The parent re-renders once per project as each project's
 * first-day task count lands (`projectsHaveTasksInFirstDay`), which without
 * memoisation re-rendered ALL 78 subtrees every time (~6,000 renders for one
 * board load). Every prop below is now referentially stable (see the `useMemo`
 * on `sortedLoggedUserProjectIds` in OpenTasksViewAllProjects), so the default
 * shallow comparison lets a project block re-render only when its own props or
 * its own `useSelector` slices actually change. This changes nothing about what
 * is rendered - the component reads all of its data from the store itself.
 */
export default React.memo(OpenTasksByProject)
