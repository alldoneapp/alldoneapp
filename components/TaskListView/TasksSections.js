import React from 'react'
import { useSelector } from 'react-redux'

import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import TasksByProjectSections from './TasksByProjectSections'
import MyDayView from '../MyDayView/MyDayView'

export default function TasksSections() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const showAllProjectsByTime = useSelector(state => state.loggedUser.showAllProjectsByTime)
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    const inMyDay = showAllProjectsByTime && inAllProjects

    return inMyDay ? <MyDayView /> : <TasksByProjectSections />
}
