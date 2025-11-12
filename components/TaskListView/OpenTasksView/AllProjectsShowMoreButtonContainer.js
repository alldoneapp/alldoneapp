import React from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { View } from 'react-native'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { contractOpenTasks, updateOpTasks, watchOpenTasks, unwatchOpenTasks } from '../../../utils/backends/openTasks'
import { setLaterTasksExpandState } from '../../../redux/actions'
import store from '../../../redux/store'

export default function AllProjectsShowMoreButtonContainer({ projectIds, setProjectsHaveTasksInFirstDay }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const laterTasksExpandState = useSelector(state => state.laterTasksExpandState)
    const hasTomorrowTasks = useSelector(state => state.openTasksShowMoreData.hasTomorrowTasks)
    const hasFutureTasks = useSelector(state => state.openTasksShowMoreData.hasFutureTasks)
    const hasSomedayTasks = useSelector(state => state.openTasksShowMoreData.hasSomedayTasks)

    const thereAreLaterOrSomedayObjects = hasTomorrowTasks || hasFutureTasks || hasSomedayTasks

    const expandToTomorrow = () => {
        // State 0 -> State 1: Show today + tomorrow
        dispatch(setLaterTasksExpandState(1))

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
            }

            // Unwatch existing listeners before setting up new ones
            unwatchOpenTasks(projectId, instanceKey)
            // Show today + tomorrow: showLaterTasks=true, showSomedayTasks=false (with endOfTomorrow filter)
            watchOpenTasks(projectId, updateTasks, true, false, true, instanceKey)
        })
    }

    const expandToAllFuture = () => {
        // State 1 -> State 2: Show all future + someday
        dispatch(setLaterTasksExpandState(2))

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
            }

            // Unwatch existing listeners before setting up new ones
            unwatchOpenTasks(projectId, instanceKey)
            // Show all: showLaterTasks=true, showSomedayTasks=true
            watchOpenTasks(projectId, updateTasks, true, true, true, instanceKey)
        })
    }

    const contractTasks = () => {
        // Any state -> State 0: Show only today
        dispatch(setLaterTasksExpandState(0))

        projectIds.forEach(projectId => {
            const instanceKey = projectId + loggedUserId

            const openTasksStore = store.getState().openTasksStore[instanceKey]
            const openTasks = openTasksStore ? openTasksStore : []

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

            contractOpenTasks(projectId, instanceKey, openTasks, updateTasks)
        })
    }

    return thereAreLaterOrSomedayObjects ? (
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
    ) : null
}
