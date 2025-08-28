import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import {
    hideFloatPopup,
    setLaterTasksExpanded,
    setSomedayTasksExpanded,
    hideWebSideBar,
    pressShowLaterTasksInAllProjects,
} from '../../../redux/actions'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { watchOpenTasks, contractOpenTasks, updateOpTasks } from '../../../utils/backends/openTasks'
import store from '../../../redux/store'
import { dismissAllPopups } from '../../../utils/HelperFunctions'

export default function TopShowMoreButton({ instanceKey, projectIndex, setProjectsHaveTasksInFirstDay }) {
    const dispatch = useDispatch()
    const projectId = useSelector(state => state.loggedUserProjects[projectIndex].id)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const laterTasksExpanded = useSelector(state => state.laterTasksExpanded)

    const updateTaks = (initialTasks, initialLoadingInOpenTasks) => {
        const { selectedProjectIndex } = store.getState()
        const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
        updateOpTasks(
            projectId,
            instanceKey,
            initialTasks,
            initialLoadingInOpenTasks,
            setProjectsHaveTasksInFirstDay,
            inSelectedProject
        )
    }

    const expandTasks = () => {
        const { thereAreLaterOpenTasks, thereAreLaterEmptyGoals, selectedProjectIndex } = store.getState()
        const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

        const thereAreLaterObjects = thereAreLaterOpenTasks[projectId] || thereAreLaterEmptyGoals[projectId]

        if (inSelectedProject) {
            thereAreLaterObjects
                ? dispatch(setLaterTasksExpanded(true))
                : dispatch([setLaterTasksExpanded(true), setSomedayTasksExpanded(true)])
            watchOpenTasks(projectId, updateTaks, true, !thereAreLaterObjects, true, instanceKey)
        } else {
            const { loggedUser } = store.getState()
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            dismissAllPopups(true, true, true)
            const actionsToDispatch = [hideFloatPopup()]

            if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())
            dispatch(actionsToDispatch)
            dispatch(pressShowLaterTasksInAllProjects(projectIndex, projectType, projectId, thereAreLaterObjects))
        }
    }

    const contractTasks = () => {
        const openTasksStore = store.getState().openTasksStore[instanceKey]
        const openTasks = openTasksStore ? openTasksStore : []
        contractOpenTasks(projectId, instanceKey, openTasks, updateTaks)
    }

    return (
        <ShowMoreButton
            expanded={laterTasksExpanded}
            contract={contractTasks}
            expand={expandTasks}
            expandText={'later tasks'}
            contractText={'hide later tasks'}
            style={{
                flex: 1,
                flexDirection: 'row',
                justifyContent: 'center',
                marginTop: 8,
            }}
        />
    )
}
