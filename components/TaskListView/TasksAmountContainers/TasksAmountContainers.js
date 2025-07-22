import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import OpenTasksAmountContainer from './OpenTasksAmountContainer'
import WorkflowTasksAmountContainer from './WorkflowTasksAmountContainer'
import DoneTasksAmountContainer from './DoneTasksAmountContainer'
import { checkIfSelectedAllProjects } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../redux/store'

export default function TasksAmountContainers() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const projectIdsAmount = useSelector(state => state.loggedUser.projectIds.length)
    const archivedProjectIdsAmount = useSelector(state => state.loggedUser.archivedProjectIds.length)
    const templateProjectIdsAmount = useSelector(state => state.loggedUser.templateProjectIds.length)
    const [projectIds, setProjectIds] = useState([])

    useEffect(() => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const { projectIds, templateProjectIds, archivedProjectIds } = loggedUser
        const normalProjectAndGuideIds = projectIds.filter(
            projectId => !templateProjectIds.includes(projectId) && !archivedProjectIds.includes(projectId)
        )
        const projectIdsToShow = checkIfSelectedAllProjects(selectedProjectIndex)
            ? normalProjectAndGuideIds
            : [loggedUserProjects[selectedProjectIndex].id]
        setProjectIds(projectIdsToShow)
    }, [projectIdsAmount, selectedProjectIndex, templateProjectIdsAmount, archivedProjectIdsAmount])

    return (
        <View>
            <OpenTasksAmountContainer projectIds={projectIds} />
            <WorkflowTasksAmountContainer projectIds={projectIds} />
            <DoneTasksAmountContainer projectIds={projectIds} />
        </View>
    )
}
