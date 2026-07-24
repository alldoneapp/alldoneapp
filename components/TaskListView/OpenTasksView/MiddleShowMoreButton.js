import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { setSomedayTasksExpanded } from '../../../redux/actions'
import { watchOpenTasks, contractOpenTasks, updateOpTasks } from '../../../utils/backends/openTasks'
import store from '../../../redux/store'

export default function MiddleShowMoreButton({ instanceKey, projectIndex, setProjectsHaveTasksInFirstDay, expanded }) {
    const dispatch = useDispatch()
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex]?.id)

    const updateTaks = (initialTasks, initialLoadingInOpenTasks) => {
        updateOpTasks(
            projectId,
            instanceKey,
            initialTasks,
            initialLoadingInOpenTasks,
            setProjectsHaveTasksInFirstDay,
            true
        )
    }

    const expandTasks = () => {
        watchOpenTasks(projectId, updateTaks, true, true, true, instanceKey)
        dispatch(setSomedayTasksExpanded(true))
    }

    const contractTasks = () => {
        const openTasksStore = store.getState().openTasksStore[instanceKey]
        const openTasks = openTasksStore ? openTasksStore : []
        contractOpenTasks(projectId, instanceKey, openTasks, updateTaks)
    }

    return (
        <ShowMoreButton
            expanded={expanded}
            contract={contractTasks}
            expand={expandTasks}
            expandText={'later tasks'}
            contractText={'hide later tasks'}
            style={{
                flex: 0,
                flexDirection: 'row',
                justifyContent: 'center',
                marginTop: 8,
                marginRight: expanded ? undefined : 16,
            }}
        />
    )
}
