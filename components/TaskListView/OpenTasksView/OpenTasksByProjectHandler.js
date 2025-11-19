import { useEffect } from 'react'
import moment from 'moment'
import { difference, isEmpty } from 'lodash'
import { useDispatch, useSelector, shallowEqual } from 'react-redux'

import {
    setLastAddNewTaskDate,
    clearOpenTasksMap,
    clearOpenSubtasksMap,
    setTaskListWatchersVars,
    setTodayEmptyGoalsTotalAmountInOpenTasksView,
    setLaterTasksExpandedForNavigateFromAllProjects,
    setSomedayTasksExpandedForNavigateFromAllProjects,
    updateOpenTasks,
    updateThereAreHiddenNotMainTasks,
    updateFilteredOpenTasks,
    updateSubtaskByTask,
    updateThereAreNotTasksInFirstDay,
    updateInitialLoadingEndOpenTasks,
    updateInitialLoadingEndObservedTasks,
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

export default function OpenTasksByProjectHandler({ projectIndex, firstProject, setProjectsHaveTasksInFirstDay }) {
    const dispatch = useDispatch()
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex].id)
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

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    const clearTasksAndWatchers = () => {
        dispatch([clearOpenTasksMap(projectId), clearOpenSubtasksMap(projectId)])
        unwatchOpenTasks(projectId, currentUserId)
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

    // Removed auto-sync on page load - users should manually trigger sync via the sync button
    // Auto-syncing was causing race conditions and duplicate task creation/deletion

    useEffect(() => {
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
    ])

    useEffect(() => {
        if (currentUserId) {
            const {
                laterTasksExpandedForNavigateFromAllProjects,
                somedayTasksExpandedForNavigateFromAllProjects,
            } = store.getState()
            clearTasksAndWatchers()
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
                false,
                instanceKey
            )

            return () => {
                dispatch([setTodayEmptyGoalsTotalAmountInOpenTasksView(projectId, 0)])
                clearTasksAndWatchers()
            }
        }
    }, [])

    useEffect(() => {
        const { openTasksStore } = store.getState()
        const openTasks = openTasksStore[instanceKey] ? openTasksStore[instanceKey] : []
        filterOpTasks(instanceKey, openTasks)
    }, [JSON.stringify(filtersArray)])

    if (!currentUserId.startsWith(WORKSTREAM_ID_PREFIX)) {
        useEffectDebug(
            changedDeps => {
                if (!isEmpty(changedDeps) && currentUserId) {
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
                                userId
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

    useEffect(() => {
        return () => {
            dispatch(updateOpenTasks(instanceKey, null))
            dispatch(updateThereAreHiddenNotMainTasks(instanceKey, null))
            dispatch(updateFilteredOpenTasks(instanceKey, null))
            dispatch(updateSubtaskByTask(instanceKey, null))
            dispatch(updateThereAreNotTasksInFirstDay(instanceKey, null))
            dispatch(updateInitialLoadingEndOpenTasks(instanceKey, null))
            dispatch(updateInitialLoadingEndObservedTasks(instanceKey, null))
        }
    }, [])

    return null
}
