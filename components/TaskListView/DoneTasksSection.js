import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import DoneTasksView from './DoneTasksView/DoneTasksView'
import DoneTasksViewAllProjects from './DoneTasksView/DoneTasksViewAllProjects'
import { resetLoadingData } from '../../redux/actions'

export default function DoneTasksSection() {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    useEffect(() => {
        dispatch(resetLoadingData())
        return () => {
            dispatch(resetLoadingData())
        }
    }, [])

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    return <View style={{ flex: 1 }}>{inSelectedProject ? <DoneTasksView /> : <DoneTasksViewAllProjects />}</View>
}
