import React from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { View } from 'react-native'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { contractOpenTasks, updateOpTasks, watchOpenTasks } from '../../../utils/backends/openTasks'
import { setLaterTasksExpanded, setSomedayTasksExpanded } from '../../../redux/actions'
import store from '../../../redux/store'

export default function AllProjectsShowMoreButtonContainer({ projectIds, setProjectsHaveTasksInFirstDay }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const laterTasksExpanded = useSelector(state => state.laterTasksExpanded)
    const somedayTasksExpanded = useSelector(state => state.somedayTasksExpanded)
    const hasFutureTasks = useSelector(state => state.openTasksShowMoreData.hasFutureTasks)
    const hasSomedayTasks = useSelector(state => state.openTasksShowMoreData.hasSomedayTasks)

    const thereAreLaterOrSomedayObjects = hasFutureTasks || hasSomedayTasks

    const expandTasks = () => {
        if (laterTasksExpanded) {
            if (hasSomedayTasks) {
                dispatch([setLaterTasksExpanded(true), setSomedayTasksExpanded(true)])
            }
        } else {
            if (hasFutureTasks) {
                dispatch(setLaterTasksExpanded(true))
            } else if (hasSomedayTasks) {
                dispatch([setLaterTasksExpanded(true), setSomedayTasksExpanded(true)])
            }
        }

        projectIds.forEach(projectId => {
            const instanceKey = projectId + loggedUserId

            const updateTaks = (initialTasks, initialLoadingInOpenTasks) => {
                updateOpTasks(
                    projectId,
                    instanceKey,
                    initialTasks,
                    initialLoadingInOpenTasks,
                    setProjectsHaveTasksInFirstDay,
                    false
                )
            }

            const showSomedayObjects =
                hasSomedayTasks &&
                ((!laterTasksExpanded && !hasFutureTasks) || (laterTasksExpanded && !somedayTasksExpanded))
            watchOpenTasks(projectId, updateTaks, true, showSomedayObjects, true, instanceKey)
        })
    }

    const contractTasks = () => {
        projectIds.forEach(projectId => {
            const instanceKey = projectId + loggedUserId

            const openTasksStore = store.getState().openTasksStore[instanceKey]
            const openTasks = openTasksStore ? openTasksStore : []

            const updateTaks = (initialTasks, initialLoadingInOpenTasks) => {
                updateOpTasks(
                    projectId,
                    instanceKey,
                    initialTasks,
                    initialLoadingInOpenTasks,
                    setProjectsHaveTasksInFirstDay,
                    false
                )
            }

            contractOpenTasks(projectId, instanceKey, openTasks, updateTaks)
        })
    }

    return thereAreLaterOrSomedayObjects ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
            {((!laterTasksExpanded && hasFutureTasks) || (!somedayTasksExpanded && hasSomedayTasks)) && (
                <ShowMoreButton
                    expanded={false}
                    expand={expandTasks}
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
            {laterTasksExpanded && (
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
        </View>
    ) : null
}
