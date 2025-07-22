import React from 'react'
import { useSelector } from 'react-redux'
import moment from 'moment'

import MyDayOpenTasksList from './MyDayOpenTasksList'
import MyDayDateLine from '../MyDayDateLine'
import MyDayDroppableTaskList from '../../../DragSystem/MyDayDroppableTaskList'

export default function MyDaySelectedTasks() {
    const myDaySelectedTasks = useSelector(state => state.myDaySelectedTasks)
    const myDaySortingSelectedTasks = useSelector(state => state.myDaySortingSelectedTasks)
    const activeDragTaskModeInMyDay = useSelector(state => state.activeDragTaskModeInMyDay)

    const date = moment().format('YYYYMMDD')

    const taskList = activeDragTaskModeInMyDay ? myDaySortingSelectedTasks : myDaySelectedTasks

    return (
        <>
            <MyDayDateLine tasks={taskList} date={date} />
            {activeDragTaskModeInMyDay ? (
                <MyDayDroppableTaskList taskListId={date} taskList={taskList} />
            ) : (
                <MyDayOpenTasksList tasks={taskList} />
            )}
        </>
    )
}
