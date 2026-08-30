import { useEffect, useLayoutEffect } from 'react'
import moment from 'moment'
import { difference, isEmpty } from 'lodash'
import { useDispatch, useSelector, shallowEqual } from 'react-redux'

import {
    setLastAddNewTaskDate,
    clearOpenTasksMap,
    clearOpenSubtasksMap,
    setTaskListWatchersVars,
    setLaterTasksExpandedForNavigateFromAllProjects,
    setSomedayTasksExpandedForNavigateFromAllProjects,
} from '../../../redux/actions'
import { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import {
    watchOpenTasks,
    unwatchOpenTasks,
    addWatchersForOneStreamAndUser,
    WATCHER_VARS_DEFAULT,
    contractOpenTasks,
    filterOpTasks,
    updateOpTasks,
    contractSomedayOpenTasks,
} from '../../../utils/backends/openTasks'
import useEffectDebug from '../../../hooks/useEffectDebug'
import { cleanDataWhenRemoveWorkstreamMember, WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import store from '../../../redux/store'
import useSelectorHashtagFilters from '../../HashtagFilters/UseSelectorHashtagFilters'
import { checkIfCalendarConnected } from '../../../utils/backends/firestore'
import { fetchEmailLineSummary } from '../../../utils/backends/EmailLine/emailLineBackend'
import { useIsUserEditing } from '../../../utils/editingGuard'

export default function OpenTasksByProjectHandler({
    projectIndex,
    firstProject,
    setProjectsHaveTasksInFirstDay,
    assistantProfileMode = false,
    taskWatchersEnabled = true,
}) {
    const dispatch = useDispatch()
    // Contracting the day list re-subscribes the open-task watchers with an
    // empty cache, which unmounts every OpenTasksByDate block - and with it any
    // open editor. Defer it while the user is typing. See utils/editingGuard.js.
    const isUserEditing = useIsUserEditing()
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex]?.id)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const laterTasksExpanded = useSelector(state => state.laterTasksExpanded)
    const somedayTasksExpanded = useSelector(state => state.somedayTasksExpanded)
    const thereAreLaterOpenTasksInProject = useSelector(state => state.thereAreLaterOpenTasks[projectId])
    const thereAreLaterEmptyGoalsInProject = useSelector(state => state.thereAreLaterEmptyGoals[projectId])
    const thereAreSomedayOpenTasksInProject = useSelector(state => state.thereAreSomedayOpenTasks[projectId])
    const thereAreSomedayEmptyGoalsInProject = useSelector(state => state.thereAreSomedayEmptyGoals[projectId])

    const currentUserId = useSelector(state => state.currentUser.uid)
    const currentUserWorkstreamsIds = useSelector(
        state => (state.currentUser.workstreams ? state.currentUser.workstreams[projectId] : null),
        shallowEqual
    )

    const instanceKey = projectId + currentUserId

    const [filters, filtersArray] = useSelectorHashtagFilters()
    const taskPriorityFilters = useSelector(state => state.taskPriorityFilters, shallowEqual)
    const taskVmStateFilters = useSelector(state => state.taskVmStateFilters, shallowEqual)
    const taskVmStatesByTask = useSelector(
        state => (taskVmStateFilters.length > 0 ? state.taskVmStatesByTask : null),
        shallowEqual
    )

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    const stopTasksWatchers = ({ preserveSessionSnapshot = false } = {}) => {
        if (!preserveSessionSnapshot) {
            dispatch([clearOpenTasksMap(projectId), clearOpenSubtasksMap(projectId)])
        }
        unwatchOpenTasks(projectId, currentUserId, { preserveData: preserveSessionSnapshot })
    }

    const updateTaks = (initialTasks, initialLoadingInOpenTasks) => {
        updateOpTasks(
            projectId,
            instanceKey,
            initialTasks,
            initialLoadingInOpenTasks,
            setProjectsHaveTasksInFirstDay,
            inSelectedProject
        )
    }

    useLayoutEffect(() => {
        const {
            openTasksStore,
            laterTasksExpandedForNavigateFromAllProjects,
            somedayTasksExpandedForNavigateFromAllProjects,
        } = store.getState()
        const retainedTasks = openTasksStore[instanceKey]
        if (!retainedTasks) return

        const keepExpandedDays =
            laterTasksExpanded ||
            somedayTasksExpanded ||
            laterTasksExpandedForNavigateFromAllProjects ||
            somedayTasksExpandedForNavigateFromAllProjects
        const tasksForCurrentView = keepExpandedDays ? retainedTasks : retainedTasks.slice(0, 1)

        // A selected-project snapshot contains sections that All Projects deliberately hides.
        // Re-apply the current view projection before paint so navigating selected -> All Projects
        // cannot flash observed/workstream rows from the previous task-board context.
        updateOpTasks(projectId, instanceKey, tasksForCurrentView, undefined, null, inSelectedProject)
    }, [])

    // Keep integration refreshes out of the All Projects mount fan-out. The
    // unified Email line refreshes connected accounts once, while calendar is
    // refreshed on the selected project (and by its server-side sync).
    useEffect(() => {
        const { loggedUser } = store.getState()
        if (inSelectedProject && currentUserId === loggedUser.uid) {
            const projectApis = loggedUser.apisConnected?.[projectId]
            if (projectApis?.calendar) {
                if (__DEV__)
                    console.log('[OpenTasksByProjectHandler] 📅 Checking calendar sync for project:', projectId)
                checkIfCalendarConnected(projectId)
            }
            if (projectApis?.email || projectApis?.gmail) {
                if (__DEV__)
                    console.log('[OpenTasksByProjectHandler] 📧 Fetching email line summary for project:', projectId)
                fetchEmailLineSummary(projectId)
            }
        }
    }, [projectId, currentUserId, inSelectedProject])

    useEffect(() => {
        // These flags are written straight from onSnapshot, so a task completed
        // by an assistant can collapse the list under an open editor. Skipping
        // is safe: `isUserEditing` is in the dependency list, so the contraction
        // is re-evaluated as soon as the user is done.
        if (isUserEditing) return

        if (inSelectedProject) {
            const {
                laterTasksExpandedForNavigateFromAllProjects,
                somedayTasksExpandedForNavigateFromAllProjects,
                openTasksStore,
            } = store.getState()

            const thereAreNoLaterObjects =
                thereAreLaterOpenTasksInProject === false && thereAreLaterEmptyGoalsInProject === false
            const thereAreNoSomedayObjects =
                thereAreSomedayOpenTasksInProject === false && thereAreSomedayEmptyGoalsInProject === false
            if (!laterTasksExpandedForNavigateFromAllProjects && !somedayTasksExpandedForNavigateFromAllProjects) {
                if (somedayTasksExpanded) {
                    if (thereAreNoSomedayObjects) {
                        if (thereAreNoLaterObjects) {
                            const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []
                            contractOpenTasks(projectId, instanceKey, openTasks, updateTaks)
                        } else {
                            const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []
                            contractSomedayOpenTasks(projectId, instanceKey, openTasks, updateTaks)
                        }
                    }
                } else if (laterTasksExpanded) {
                    if (thereAreNoLaterObjects) {
                        const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []
                        contractOpenTasks(projectId, instanceKey, openTasks, updateTaks)
                    }
                }
            }
        }
    }, [
        thereAreLaterOpenTasksInProject,
        thereAreLaterEmptyGoalsInProject,
        thereAreSomedayOpenTasksInProject,
        thereAreSomedayEmptyGoalsInProject,
        isUserEditing,
    ])

    useEffect(() => {
        if (currentUserId && taskWatchersEnabled) {
            const {
                laterTasksExpandedForNavigateFromAllProjects,
                somedayTasksExpandedForNavigateFromAllProjects,
                openTasksStore,
                globalDataByProject,
            } = store.getState()
            const hasRenderedSessionSnapshot = openTasksStore[instanceKey] !== undefined
            const canReuseWatcherData = hasRenderedSessionSnapshot && !!globalDataByProject[projectId]

            stopTasksWatchers({ preserveSessionSnapshot: hasRenderedSessionSnapshot })
            dispatch([
                setTaskListWatchersVars(WATCHER_VARS_DEFAULT),
                setLaterTasksExpandedForNavigateFromAllProjects(false),
                setSomedayTasksExpandedForNavigateFromAllProjects(false),
            ])
            watchOpenTasks(
                projectId,
                updateTaks,
                laterTasksExpandedForNavigateFromAllProjects,
                somedayTasksExpandedForNavigateFromAllProjects,
                canReuseWatcherData,
                instanceKey,
                assistantProfileMode,
                {
                    trackConnectionHealth: inSelectedProject,
                    deferSecondaryStreams: !inSelectedProject,
                }
            )

            return () => {
                // Keep the last published task/decorator snapshot in Redux and the mutable watcher
                // indexes in globalDataByProject. Returning from Notes/Goals/etc. can paint those
                // rows immediately; the newly attached listeners reconcile them in the background.
                stopTasksWatchers({ preserveSessionSnapshot: true })
            }
        }
    }, [taskWatchersEnabled])

    useEffect(() => {
        const { openTasksStore } = store.getState()
        const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []
        filterOpTasks(instanceKey, openTasks, projectId)
    }, [
        JSON.stringify(filtersArray),
        JSON.stringify(taskPriorityFilters),
        JSON.stringify(taskVmStateFilters),
        taskVmStatesByTask,
    ])

    // Task filters match parents by their subtasks too, so subtask changes must
    // re-run the filter while one is active.
    const subtasksByParentId = useSelector(state =>
        taskPriorityFilters.length > 0 || taskVmStateFilters.length > 0 ? state.subtaskByTaskStore[instanceKey] : null
    )
    useEffect(() => {
        if (taskPriorityFilters.length === 0 && taskVmStateFilters.length === 0) return
        const { openTasksStore } = store.getState()
        const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []
        filterOpTasks(instanceKey, openTasks, projectId)
    }, [subtasksByParentId])

    if (!currentUserId.startsWith(WORKSTREAM_ID_PREFIX)) {
        useEffectDebug(
            changedDeps => {
                if (!isEmpty(changedDeps) && currentUserId && taskWatchersEnabled) {
                    let changes = changedDeps.streams

                    if (changes.before) {
                        const { taskListWatchersVars } = store.getState()
                        let userIdsToAdd = difference(changes.after, changes.before)
                        let userIdsToRemove = difference(changes.before, changes.after)

                        for (let userId of userIdsToAdd) {
                            addWatchersForOneStreamAndUser(
                                projectId,
                                updateTaks,
                                taskListWatchersVars.storedTasks,
                                taskListWatchersVars.estimationByDate,
                                taskListWatchersVars.amountOfTasksByDate,
                                taskListWatchersVars.tasksMap,
                                taskListWatchersVars.subtasksByParentId,
                                taskListWatchersVars.subtasksMap,
                                laterTasksExpanded,
                                somedayTasksExpanded,
                                userId,
                                inSelectedProject
                            )
                        }

                        const { openTasksStore } = store.getState()
                        const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []

                        for (let userId of userIdsToRemove) {
                            cleanDataWhenRemoveWorkstreamMember(projectId, currentUserId, userId, openTasks, updateTaks)
                        }
                    }
                }
            },
            [currentUserWorkstreamsIds || []],
            ['streams']
        )
    }

    useEffect(() => {
        if (firstProject) {
            const date = moment().valueOf()
            dispatch(setLastAddNewTaskDate({ projectId: projectId, date }))
        }
    }, [firstProject])

    return null
}
