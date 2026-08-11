import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import AllProjectsEmptyInbox from '../../../TaskListView/OpenTasksView/AllProjectsEmptyInbox'
import MyDayDoneTasksList from './MyDayDoneTasksList'
import AssistantLine from '../../AssistantLine/AssistantLine'
import AllProjectsLine from '../../../TaskListView/Header/AllProjectsLine/AllProjectsLine'

export default function MyDayDoneTasks() {
    const myDayDoneTasksAmount = useSelector(state => state.myDayDoneTasks.length)
    const tasksLoaded = useSelector(state => state.myDayDoneTasksByProject.loaded)

    const needToShowEmptyBoardPicture = myDayDoneTasksAmount === 0
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
                    <MyDayDoneTasksList />
                </View>
            )}
        </>
    )
}
