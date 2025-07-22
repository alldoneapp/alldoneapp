import React from 'react'
import { useSelector, useDispatch } from 'react-redux'

import MultiToggleSwitch from '../../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import { setTaskViewToggleIndex, setTaskViewToggleSection } from '../../../redux/actions'
import { AMOUNT_TASKS_INDEX, DATE_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import { BACKLOG_DATE_STRING, TOGGLE_INDEX_DONE } from '../../TaskListView/Utils/TasksHelper'
import { GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY, GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS } from '../../GoalsView/GoalsHelper'

export default function GoalTasksMultiToggleSwitch() {
    const dispatch = useDispatch()
    const goalOpenTasksData = useSelector(state => state.goalOpenTasksData)
    const goalWorkflowTasksData = useSelector(state => state.goalWorkflowTasksData)
    const goalDoneTasksData = useSelector(state => state.goalDoneTasksData)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)
    const goalOpenTasksExpandState = useSelector(state => state.goalOpenTasksExpandState)
    const goalDoneTasksExpandedAmount = useSelector(state => state.goalDoneTasksExpandedAmount)

    const onChangeToggleOption = (index, optionText) => {
        dispatch([setTaskViewToggleIndex(index), setTaskViewToggleSection(optionText)])
    }

    const getOpenTasksAmount = () => {
        const goalOpenTasksDataToShow =
            goalOpenTasksData.length > 0
                ? goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY
                    ? [goalOpenTasksData[0]]
                    : goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS
                    ? goalOpenTasksData.filter(tasksData => tasksData[DATE_TASK_INDEX] !== BACKLOG_DATE_STRING)
                    : goalOpenTasksData
                : []
        let amount = 0
        goalOpenTasksDataToShow.forEach(taskData => {
            amount += taskData[AMOUNT_TASKS_INDEX]
        })
        return amount
    }

    const getWorkflowTasksAmount = () => {
        let amount = 0
        goalWorkflowTasksData.forEach(taskData => {
            amount += taskData[1]
        })
        return amount
    }

    const getDoneTasksAmount = () => {
        let amount = 0
        goalDoneTasksData.forEach(taskData => {
            amount += taskData[1]
        })

        if (taskViewToggleIndex !== TOGGLE_INDEX_DONE) return amount

        const amountFirstDay = goalDoneTasksData.length > 0 ? goalDoneTasksData[0][1] : 0
        amount -= amountFirstDay

        amount = amountFirstDay + (amount > goalDoneTasksExpandedAmount ? goalDoneTasksExpandedAmount : amount)
        return amount
    }

    const openAmount = getOpenTasksAmount()
    const workflowAmount = getWorkflowTasksAmount()
    const doneAmount = getDoneTasksAmount()

    return (
        <MultiToggleSwitch
            containerStyle={localStyles.toggleSwitch}
            options={[
                {
                    icon: 'square',
                    text: 'Open',
                    badge: openAmount,
                },
                {
                    icon: 'workflow',
                    text: 'Workflow',
                    badge: workflowAmount,
                },
                {
                    icon: 'square-checked-gray',
                    text: 'Done',
                    badge: doneAmount,
                },
            ]}
            currentIndex={taskViewToggleIndex}
            onChangeOption={onChangeToggleOption}
        />
    )
}

const localStyles = {
    toggleSwitch: {
        position: 'absolute',
        right: 0,
        top: 33,
        zIndex: 10,
    },
}
