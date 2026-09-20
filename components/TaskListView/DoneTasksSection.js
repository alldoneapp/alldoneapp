import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import DoneTasksView from './DoneTasksView/DoneTasksView'
import DoneTasksViewAllProjects from './DoneTasksView/DoneTasksViewAllProjects'

export default function DoneTasksSection() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    return <View style={{ flex: 1 }}>{inSelectedProject ? <DoneTasksView /> : <DoneTasksViewAllProjects />}</View>
}
