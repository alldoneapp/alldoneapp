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
    // AT-2262: the congrats renders right under the assistant line (which also shows the
    // latest comment) instead of at the very bottom of the page, so it is visible without
    // scrolling — but it never pushes the assistant composer / last comment down.
    const showEmptyInbox = tasksLoaded && needToShowEmptyBoardPicture

    return (
        <>
            <AllProjectsLine />
            <AssistantLine useAssistantProjectContext={false} />
            {showEmptyInbox && <AllProjectsEmptyInbox />}
            {!showEmptyInbox && (
                <View style={{ marginTop: 16, marginBottom: 32 }}>
                    <MyDayDoneTasksList />
                </View>
            )}
        </>
    )
}
