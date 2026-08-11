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
    // AT-2262: show the congrats right under the All Projects line (above the
    // assistant composer) so it is visible without scrolling.
    const showEmptyInbox = tasksLoaded && needToShowEmptyBoardPicture

    return (
        <>
            <AllProjectsLine />
            {showEmptyInbox && <AllProjectsEmptyInbox />}
            <AssistantLine useAssistantProjectContext={false} />
            {!showEmptyInbox && (
                <View style={{ marginTop: 16, marginBottom: 32 }}>
                    <MyDayWorkflowTasksList />
                </View>
            )}
        </>
    )
}
