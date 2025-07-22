import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import AllProjectsEmptyInbox from '../../../TaskListView/OpenTasksView/AllProjectsEmptyInbox'
import MyDayWorkflowTasksList from './MyDayWorkflowTasksList'
import AssistantLine from '../../AssistantLine/AssistantLine'
import AllProjectsLine from '../../../TaskListView/Header/AllProjectsLine/AllProjectsLine'

export default function MyDayWorkflowTasks() {
    const myDayWorkflowTasksAmount = useSelector(state => state.myDayWorkflowTasks.length)
    const tasksLoaded = useSelector(state => state.myDayWorkflowTasksByProject.loaded)

    const needToShowEmptyBoardPicture = myDayWorkflowTasksAmount === 0

    return (
        <>
            <AllProjectsLine />
            <AssistantLine />
            {tasksLoaded && needToShowEmptyBoardPicture ? (
                <AllProjectsEmptyInbox />
            ) : (
                <View style={{ marginTop: 16, marginBottom: 32 }}>
                    <MyDayWorkflowTasksList />
                </View>
            )}
        </>
    )
}
