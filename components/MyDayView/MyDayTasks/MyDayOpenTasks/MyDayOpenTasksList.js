import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import ParentTaskContainer from '../../../TaskListView/ParentTaskContainer'
import useSelectorHashtagFilters from '../../../HashtagFilters/UseSelectorHashtagFilters'
import { taskMatchHashtagFilters } from '../../../HashtagFilters/FilterHelpers/FilterTasks'

export default function MyDayOpenTasksList({ tasks }) {
    const myDayOpenSubtasksMap = useSelector(state => state.myDayOpenSubtasksMap)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [filters, filtersArray] = useSelectorHashtagFilters()

    const lastTaskIndex = tasks.length - 1
    const endOfDay = moment().endOf('day').valueOf()

    const filteredTasks = filtersArray.length > 0 ? tasks.filter(task => taskMatchHashtagFilters(task)) : tasks

    return (
        <View style={{ marginTop: 16 }}>
            {filteredTasks.map((task, index) => {
                const {
                    projectId,
                    stepHistory,
                    suggestedBy,
                    userId,
                    userIds,
                    dueDateByObserversIds,
                    currentReviewerId,
                    dueDate,
                } = task
                const subtaskList = myDayOpenSubtasksMap[projectId]?.[task.id] || []
                const isObservedTask = dueDateByObserversIds[loggedUserId] <= endOfDay
                const isSuggested = suggestedBy && userId === loggedUserId
                const marginBottom = lastTaskIndex === index ? 0 : 16
                const isToReviewTask = userIds.length > 1 && currentReviewerId === loggedUserId && dueDate <= endOfDay
                const currentStepId = stepHistory[stepHistory.length - 1]
                const key = isToReviewTask ? task.id + currentStepId : task.id
                return (
                    <ParentTaskContainer
                        key={key}
                        task={task}
                        projectId={projectId}
                        subtaskList={subtaskList}
                        containerStyle={{ marginHorizontal: 8, marginBottom }}
                        isObservedTask={isObservedTask}
                        isToReviewTask={isToReviewTask}
                        isSuggested={isSuggested}
                    />
                )
            })}
        </View>
    )
}
