import React from 'react'
import { View } from 'react-native'
import moment from 'moment'

import DateHeader from '../Header/DateHeader'
import ParentTaskContainer from '../ParentTaskContainer'

export default function DoneTasksByDate({
    projectId,
    taskList,
    subtaskByTask,
    dateFormated,
    firstDateSection,
    estimation,
}) {
    const date = moment(dateFormated, 'YYYYMMDD')
    const isToday = date.isSame(moment(), 'day')
    const showSection = taskList.length > 0 || isToday

    return showSection ? (
        <View>
            <DateHeader
                dateText={date.calendar(null, {
                    sameDay: '[TODAY]',
                    nextDay: '[TOMORROW]',
                    lastDay: '[YESTERDAY]',
                    nextWeek: 'YYYY/MM/DD',
                    lastWeek: 'YYYY/MM/DD',
                    sameElse: 'YYYY/MM/DD',
                })}
                isToday={isToday}
                estimation={estimation}
                date={date}
                amountTasks={taskList.length}
                firstDateSection={firstDateSection}
                projectId={projectId}
            />
            {taskList.map(task => {
                const subtaskList = subtaskByTask[task.id] ? subtaskByTask[task.id] : []
                return (
                    <ParentTaskContainer
                        key={task.id}
                        task={task}
                        projectId={projectId}
                        subtaskList={subtaskList ? subtaskList : []}
                    />
                )
            })}
        </View>
    ) : null
}
