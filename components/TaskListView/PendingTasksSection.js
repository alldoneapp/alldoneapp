import React from 'react'
import { View } from 'react-native'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import PendingTasksView from './PendingTasksView/PendingTasksView'

import { useSelector } from 'react-redux'
import PendingTasksViewAllProjects from './PendingTasksView/PendingTasksViewAllProjects'

export default function PendingTasksSection() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const workflowTasksAmount = useSelector(state => state.workflowTasksAmount.amount)
    const workflowTasksAmountsLoaded = useSelector(state => state.workflowTasksAmount.loaded)

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    return (
        <View style={{ flex: 1 }}>
            {inSelectedProject ? (
                <PendingTasksView />
            ) : (
                <PendingTasksViewAllProjects
                    workflowTasksAmount={workflowTasksAmountsLoaded ? workflowTasksAmount : null}
                />
            )}
        </View>
    )
}
