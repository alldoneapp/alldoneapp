import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import MyDayDateLine from '../MyDayDateLine'
import ParentTaskContainer from '../../../TaskListView/ParentTaskContainer'
import useSelectorHashtagFilters from '../../../HashtagFilters/UseSelectorHashtagFilters'
import { taskMatchHashtagFilters } from '../../../HashtagFilters/FilterHelpers/FilterTasks'

export default function MyDayDoneTasksList() {
    const myDayDoneTasks = useSelector(state => state.myDayDoneTasks)
    const myDayDoneSubtasksMap = useSelector(state => state.myDayDoneSubtasksMap)
    const [filters, filtersArray] = useSelectorHashtagFilters()

    const lastTaskIndex = myDayDoneTasks.length - 1

    const filteredTasks =
        filtersArray.length > 0 ? myDayDoneTasks.filter(task => taskMatchHashtagFilters(task)) : myDayDoneTasks

    return (
        <>
            <MyDayDateLine tasks={myDayDoneTasks} date={moment().format('YYYYMMDD')} />
            <View style={{ marginTop: 16 }}>
                {filteredTasks.map((task, index) => {
                    const { projectId } = task
                    const subtaskList = myDayDoneSubtasksMap[projectId]?.[task.id] || []
                    const marginBottom = lastTaskIndex === index ? 0 : 16
                    return (
                        <ParentTaskContainer
                            key={task.id}
                            task={task}
                            projectId={projectId}
                            subtaskList={subtaskList}
                            containerStyle={{ marginHorizontal: 8, marginBottom }}
                        />
                    )
                })}
            </View>
        </>
    )
}
