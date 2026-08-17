import React, { useRef, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { View } from 'react-native'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { contractOpenTasks, updateOpTasks, watchOpenTasks } from '../../../utils/backends/openTasks'
import { setLaterTasksExpandState } from '../../../redux/actions'
import store from '../../../redux/store'
import TaskListSkeleton from '../TaskListSkeleton'
import { runInDispatchBatch } from '../../../utils/redux/dispatchBatch'

export default function AllProjectsShowMoreButtonContainer({ projectIds, setProjectsHaveTasksInFirstDay }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const laterTasksExpandState = useSelector(state => state.laterTasksExpandState)
    const hasTomorrowTasks = useSelector(state => state.openTasksShowMoreData.hasTomorrowTasks)
    const hasFutureTasks = useSelector(state => state.openTasksShowMoreData.hasFutureTasks)
    const hasSomedayTasks = useSelector(state => state.openTasksShowMoreData.hasSomedayTasks)
    const [isLoadingTasks, setIsLoadingTasks] = useState(false)
    const pendingProjectIds = useRef(new Set())

    const thereAreLaterOrSomedayObjects = hasTomorrowTasks || hasFutureTasks || hasSomedayTasks

    const startLoadingTasks = () => {
        pendingProjectIds.current = new Set(projectIds)
        setIsLoadingTasks(projectIds.length > 0)
    }

    const markProjectLoaded = projectId => {
        pendingProjectIds.current.delete(projectId)
        if (pendingProjectIds.current.size === 0) setIsLoadingTasks(false)
    }

    const expandToTomorrow = () => {
        if (isLoadingTasks) return
        // State 0 -> State 1: Show today + tomorrow
        dispatch(setLaterTasksExpandState(1))
        startLoadingTasks()

        // AT-2337: re-subscribing every project used to emit 4 store notifications
        // per project (~312 on a heavy account) in one synchronous loop. Collapse
        // the whole sweep into a single notification.
        runInDispatchBatch(() => {
            projectIds.forEach(projectId => {
                const instanceKey = projectId + loggedUserId

                const updateTasks = (initialTasks, initialLoadingInOpenTasks) => {
                    updateOpTasks(
                        projectId,
                        instanceKey,
                        initialTasks,
                        initialLoadingInOpenTasks,
                        setProjectsHaveTasksInFirstDay,
                        false
                    )
                    markProjectLoaded(projectId)
                }

                // When expanding, we need to fetch fresh data to include tomorrow's tasks
                // Use keepMainDayData=false to avoid issues with stale watcher data
                watchOpenTasks(projectId, updateTasks, true, false, false, instanceKey)
            })
        })
    }

    const expandToAllFuture = () => {
        if (isLoadingTasks) return
        // State 1 -> State 2: Show all future + someday
        dispatch(setLaterTasksExpandState(2))
        startLoadingTasks()

        // AT-2337: same sweep as expandToTomorrow - one notification, not ~312.
        runInDispatchBatch(() => {
            projectIds.forEach(projectId => {
                const instanceKey = projectId + loggedUserId

                const updateTasks = (initialTasks, initialLoadingInOpenTasks) => {
                    updateOpTasks(
                        projectId,
                        instanceKey,
                        initialTasks,
                        initialLoadingInOpenTasks,
                        setProjectsHaveTasksInFirstDay,
                        false
                    )
                    markProjectLoaded(projectId)
                }

                // When expanding, we need to fetch fresh data to include all future tasks
                // Use keepMainDayData=false to avoid issues with stale watcher data
                watchOpenTasks(projectId, updateTasks, true, true, false, instanceKey)
            })
        })
    }

    const contractTasks = () => {
        // Any state -> State 0: Show only today
        dispatch(setLaterTasksExpandState(0))
        pendingProjectIds.current.clear()
        setIsLoadingTasks(false)

        // AT-2337: deliberately NOT wrapped in runInDispatchBatch. Each iteration
        // reads `openTasksStore` back out of the store and then writes it, so
        // buffering the writes would make later reads observe pre-sweep state.
        // The expand sweeps above have no such read-after-write and are batched.
        projectIds.forEach(projectId => {
            const instanceKey = projectId + loggedUserId

            const openTasksStore = store.getState().openTasksStore[instanceKey]
            const openTasks = openTasksStore ? openTasksStore : []

            // Filter to only keep today's tasks
            const todayTasks = openTasks && openTasks.length > 0 ? [openTasks[0]] : []

            const updateTasks = (initialTasks, initialLoadingInOpenTasks) => {
                updateOpTasks(
                    projectId,
                    instanceKey,
                    initialTasks,
                    initialLoadingInOpenTasks,
                    setProjectsHaveTasksInFirstDay,
                    false
                )
            }

            // Manually update to show only today BEFORE setting up new watchers
            updateTasks(todayTasks, false)

            contractOpenTasks(projectId, instanceKey, openTasks, updateTasks)
        })
    }

    return thereAreLaterOrSomedayObjects ? (
        <>
            <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
                {laterTasksExpandState === 0 && (
                    <ShowMoreButton
                        expanded={false}
                        expand={expandToTomorrow}
                        expandText={'later tasks across all projects'}
                        style={{
                            flex: 0,
                            flexDirection: 'row',
                            justifyContent: 'center',
                            marginTop: 8,
                            marginHorizontal: 10,
                            opacity: 0.5,
                        }}
                    />
                )}
                {laterTasksExpandState >= 1 && (
                    <ShowMoreButton
                        expanded={true}
                        contract={contractTasks}
                        contractText={'hide later tasks across all projects'}
                        style={{
                            flex: 0,
                            flexDirection: 'row',
                            justifyContent: 'center',
                            marginTop: 8,
                            marginHorizontal: 10,
                            opacity: 0.5,
                        }}
                    />
                )}
                {laterTasksExpandState === 1 && (hasFutureTasks || hasSomedayTasks) && (
                    <ShowMoreButton
                        expanded={false}
                        expand={expandToAllFuture}
                        expandText={'even later tasks across all projects'}
                        style={{
                            flex: 0,
                            flexDirection: 'row',
                            justifyContent: 'center',
                            marginTop: 8,
                            marginHorizontal: 10,
                            opacity: 0.5,
                        }}
                    />
                )}
            </View>
            {isLoadingTasks && <TaskListSkeleton rowCount={1} />}
        </>
    ) : null
}
