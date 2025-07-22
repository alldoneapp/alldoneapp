import React, { useEffect } from 'react'
import { View } from 'react-native'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import PendingTasksView from './PendingTasksView/PendingTasksView'
import { resetLoadingData } from '../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import PendingTasksViewAllProjects from './PendingTasksView/PendingTasksViewAllProjects'

export default function PendingTasksSection() {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const workflowTasksAmount = useSelector(state => state.workflowTasksAmount.amount)
    const workflowTasksAmountsLoaded = useSelector(state => state.workflowTasksAmount.loaded)

    useEffect(() => {
        dispatch(resetLoadingData())
        return () => {
            dispatch(resetLoadingData())
        }
    }, [])

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
