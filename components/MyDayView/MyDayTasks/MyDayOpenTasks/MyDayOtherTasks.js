import React, { Fragment } from 'react'
import { useSelector } from 'react-redux'

import MyDayOpenTasksList from './MyDayOpenTasksList'
import MyDayDateLine from '../MyDayDateLine'
import MyDayDroppableTaskList from '../../../DragSystem/MyDayDroppableTaskList'

export default function MyDayOtherTasks() {
    const myDayOtherTasks = useSelector(state => state.myDayOtherTasks)
    const myDaySortingOtherTasks = useSelector(state => state.myDaySortingOtherTasks)
    const activeDragTaskModeInMyDay = useSelector(state => state.activeDragTaskModeInMyDay)

    const taskList = activeDragTaskModeInMyDay ? myDaySortingOtherTasks : myDayOtherTasks

    const dates = []
    const taskByDate = {}

    taskList.forEach(task => {
        const { estimatedDateFormated } = task
        if (!taskByDate[estimatedDateFormated]) {
            dates.push(estimatedDateFormated)
            taskByDate[estimatedDateFormated] = []
        }
        taskByDate[estimatedDateFormated].push(task)
    })

    return (
        <>
            {dates.map(date => {
                const tasks = taskByDate[date]
                return (
                    <Fragment key={date}>
                        <MyDayDateLine tasks={tasks} date={date} containerStyle={{ marginTop: 16 }} />
                        {activeDragTaskModeInMyDay ? (
                            <MyDayDroppableTaskList taskListId={date} taskList={tasks} />
                        ) : (
                            <MyDayOpenTasksList tasks={tasks} />
                        )}
                    </Fragment>
                )
            })}
        </>
    )
}
