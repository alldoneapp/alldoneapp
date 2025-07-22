import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import MyDayDateLine from '../MyDayDateLine'
import ParentTaskContainer from '../../../TaskListView/ParentTaskContainer'
import useSelectorHashtagFilters from '../../../HashtagFilters/UseSelectorHashtagFilters'
import { taskMatchHashtagFilters } from '../../../HashtagFilters/FilterHelpers/FilterTasks'

export default function MyDayWorkflowTasksList() {
    const myDayWorkflowTasks = useSelector(state => state.myDayWorkflowTasks)
    const myDayWorkflowSubtasksMap = useSelector(state => state.myDayWorkflowSubtasksMap)
    const [filters, filtersArray] = useSelectorHashtagFilters()

    const lastTaskIndex = myDayWorkflowTasks.length - 1

    const filteredTasks =
        filtersArray.length > 0 ? myDayWorkflowTasks.filter(task => taskMatchHashtagFilters(task)) : myDayWorkflowTasks

    return (
        <>
            <MyDayDateLine tasks={myDayWorkflowTasks} date={moment().format('YYYYMMDD')} />
            <View style={{ marginTop: 16 }}>
                {filteredTasks.map((task, index) => {
                    const { projectId } = task
                    const subtaskList = myDayWorkflowSubtasksMap[projectId]?.[task.id] || []
                    const marginBottom = lastTaskIndex === index ? 0 : 16
                    return (
                        <ParentTaskContainer
                            key={task.id}
                            task={task}
                            projectId={projectId}
                            subtaskList={subtaskList}
                            containerStyle={{ marginHorizontal: 8, marginBottom }}
                            isPending={true}
                        />
                    )
                })}
            </View>
        </>
    )
}
