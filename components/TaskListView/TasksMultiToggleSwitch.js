import React from 'react'
import { useSelector } from 'react-redux'

import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import TasksMultiToggleSwitchSelectedProject from './TasksMultiToggleSwitchSelectedProject'
import TasksMultiToggleSwitchAllProjects from './TasksMultiToggleSwitchAllProjects'

export default function TasksMultiToggleSwitch() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    return checkIfSelectedProject(selectedProjectIndex) ? (
        <TasksMultiToggleSwitchSelectedProject />
    ) : (
        <TasksMultiToggleSwitchAllProjects />
    )
}
