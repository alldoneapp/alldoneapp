import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import AllProjectsEmptyInbox from '../../../TaskListView/OpenTasksView/AllProjectsEmptyInbox'
import MyDayWorkflowTasksList from './MyDayWorkflowTasksList'
import AllProjectsAssistantLine from '../../AssistantLine/AllProjectsAssistantLine'
import AllProjectsLine from '../../../TaskListView/Header/AllProjectsLine/AllProjectsLine'

export default function MyDayWorkflowTasks() {
    const myDayWorkflowTasksAmount = useSelector(state => state.myDayWorkflowTasks.length)
    const tasksLoaded = useSelector(state => state.myDayWorkflowTasksByProject.loaded)

    const needToShowEmptyBoardPicture = myDayWorkflowTasksAmount === 0
    // AT-2262: the congrats renders right under the assistant line (which also shows the
    // latest comment) instead of at the very bottom of the page, so it is visible without
    // scrolling — but it never pushes the assistant composer / last comment down.
    const showEmptyInbox = tasksLoaded && needToShowEmptyBoardPicture

    return (
        <>
            <AllProjectsLine />
            <AllProjectsAssistantLine />
            {showEmptyInbox && <AllProjectsEmptyInbox />}
            {!showEmptyInbox && (
                <View style={{ marginTop: 16, marginBottom: 32 }}>
                    <MyDayWorkflowTasksList />
                </View>
            )}
        </>
    )
}
