import React from 'react'
import { useSelector } from 'react-redux'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { contractOpenTasks, updateOpTasks } from '../../../utils/backends/openTasks'
import { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'

export default function BottomShowMoreButton({ instanceKey, projectId, setProjectsHaveTasksInFirstDay }) {
    const openTasksStore = useSelector(state => state.openTasksStore[instanceKey])
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const openTasks = openTasksStore ? openTasksStore : []
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

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

    const contractTasks = () => {
        contractOpenTasks(projectId, instanceKey, openTasks, updateTaks)
    }

    return (
        <ShowMoreButton
            expanded={true}
            contract={contractTasks}
            expand={() => {}}
            expandText={'later tasks'}
            contractText={'hide later tasks'}
            style={{ flex: 0, flexDirection: 'row', justifyContent: 'center', marginTop: 8 }}
        />
    )
}
