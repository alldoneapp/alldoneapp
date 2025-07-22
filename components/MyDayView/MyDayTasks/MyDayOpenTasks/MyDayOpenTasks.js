import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import { DragDropContext } from 'react-beautiful-dnd'

import AllProjectsEmptyInbox from '../../../TaskListView/OpenTasksView/AllProjectsEmptyInbox'
import MyDaySelectedTasks from './MyDaySelectedTasks'
import MoreTasksLine from './MoreTasksLine'
import MyDayOtherTasks from './MyDayOtherTasks'
import { setActiveDragTaskModeInMyDay } from '../../../../redux/actions'
import AssistantLine from '../../AssistantLine/AssistantLine'
import { onBeforeCapture, onDragEnd } from '../../../DragSystem/MyDayDragHelper'
import AllProjectsLine from '../../../TaskListView/Header/AllProjectsLine/AllProjectsLine'

export default function MyDayOpenTasks() {
    const dispatch = useDispatch()
    const selectedTasksAmount = useSelector(state => state.myDaySelectedTasks.length)
    const tasksLoaded = useSelector(state => state.myDayAllTodayTasks.loaded)
    const myDayOtherTasksAmount = useSelector(state => state.myDayOtherTasks.length)
    const myDayShowAllTasks = useSelector(state => state.myDayShowAllTasks)
    const activeDragTaskModeInMyDay = useSelector(state => state.activeDragTaskModeInMyDay)
    const myDaySortingOtherTasksAmount = useSelector(state => state.myDaySortingOtherTasks.length)

    useEffect(() => {
        return () => {
            dispatch(setActiveDragTaskModeInMyDay(false))
        }
    }, [])

    const needToShowEmptyBoardPicture = selectedTasksAmount === 0 && myDayOtherTasksAmount === 0
    const showMoreTaskLine = activeDragTaskModeInMyDay ? myDaySortingOtherTasksAmount > 0 : myDayOtherTasksAmount > 0

    return (
        <>
            <AllProjectsLine />
            <AssistantLine />
            {tasksLoaded && needToShowEmptyBoardPicture ? (
                <AllProjectsEmptyInbox />
            ) : (
                <DragDropContext onDragEnd={onDragEnd} onBeforeCapture={onBeforeCapture}>
                    <View style={{ marginTop: 16, marginBottom: 32 }}>
                        <>
                            <MyDaySelectedTasks />
                            <>
                                {showMoreTaskLine && <MoreTasksLine />}
                                {myDayShowAllTasks && (
                                    <>
                                        <MyDayOtherTasks />
                                        <MoreTasksLine />
                                    </>
                                )}
                            </>
                        </>
                    </View>
                </DragDropContext>
            )}
        </>
    )
}
