import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import DoneTasksByDate from '../../TaskListView/DoneTasksView/DoneTasksByDate'
import GoalDoneShowMoreButtonsArea from './GoalDoneShowMoreButtonsArea'
import { setGoalDoneTasksExpandedAmount } from '../../../redux/actions'
import { taskMatchHashtagFilters } from '../../HashtagFilters/FilterHelpers/FilterTasks'
import { AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON } from '../../../utils/backends/doneTasks'

export default function GoalDoneTasksSection({ projectId }) {
    const dispatch = useDispatch()
    const goalDoneTasksData = useSelector(state => state.goalDoneTasksData)
    const goalDoneSubtasksByParent = useSelector(state => state.goalDoneSubtasksByParent)
    const goalDoneTasksExpandedAmount = useSelector(state => state.goalDoneTasksExpandedAmount)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const hashtagFilters = useSelector(state => state.hashtagFilters) //NEEDED FOR FORCE A RENDER

    useEffect(() => {
        const amountFirstDay = goalDoneTasksData.length > 0 ? goalDoneTasksData[0][1] : 0
        let amount = -amountFirstDay
        goalDoneTasksData.forEach(taskData => {
            amount += taskData[1]
        })

        dispatch(
            setGoalDoneTasksExpandedAmount(
                Math.ceil(amount / AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON) *
                    AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON
            )
        )
        return () => {
            dispatch(setGoalDoneTasksExpandedAmount(0))
        }
    }, [])

    let tasksLeftToShow = goalDoneTasksExpandedAmount + (goalDoneTasksData.length > 0 ? goalDoneTasksData[0][1] : 0)

    return (
        <View style={localStyles.container}>
            {goalDoneTasksData.map((tasksData, index) => {
                const tasksList = tasksData[3].slice(0, tasksLeftToShow)
                tasksLeftToShow -= tasksList.length

                return (
                    <DoneTasksByDate
                        key={tasksData[0]}
                        projectId={projectId}
                        taskList={tasksList.filter(item => taskMatchHashtagFilters(item))}
                        dateFormated={tasksData[0]}
                        firstDateSection={index === 0}
                        subtaskByTask={goalDoneSubtasksByParent}
                        estimation={tasksData[2]}
                    />
                )
            })}
            {!isAnonymous && goalDoneTasksData.length > 0 && <GoalDoneShowMoreButtonsArea />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
})
