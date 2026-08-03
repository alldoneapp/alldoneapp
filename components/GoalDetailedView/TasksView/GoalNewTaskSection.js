import React, { useRef, useEffect } from 'react'
import moment from 'moment'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import DismissibleItem from '../../UIComponents/DismissibleItem'
import store from '../../../redux/store'
import { BACKLOG_DATE_NUMERIC, BACKLOG_DATE_STRING } from '../../TaskListView/Utils/TasksHelper'
import { isInputsFocused } from '../../../utils/HelperFunctions'
import AddTask from '../../TaskListView/AddTask'
import { GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS, GOAL_OPEN_TASKS_EXPANDED_SOMEDAY } from '../../GoalsView/GoalsHelper'
import { setGoalOpenMainTasksExpanded, setGoalOpenTasksExpandState } from '../../../redux/actions'
import { DATE_TASK_INDEX, MAIN_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_TYPE_TEMPLATE } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import EditTask from '../../TaskListView/TaskItem/EditTask'

export default function GoalNewTaskSection({ projectId, goal, dateFormated }) {
    const dispatch = useDispatch()
    const newItemRef = useRef(null)
    const goalOpenTasksData = useSelector(state => state.goalOpenTasksData)
    const goalOpenTasksExpandState = useSelector(state => state.goalOpenTasksExpandState)

    const date = moment(dateFormated, 'YYYYMMDD')

    const onKeyDown = e => {
        if (store.getState().blockShortcuts) {
            return
        }
        const { lastAddNewTaskDate } = store.getState()
        const { projectId: lastPId, date: lastAddDate } = lastAddNewTaskDate
            ? lastAddNewTaskDate
            : { projectId: null, date: null }

        const shouldOpen =
            (lastAddDate == null && projectId === lastPId && date.isSame(moment(), 'day')) ||
            (lastAddDate != null && projectId === lastPId && date.isSame(moment(lastAddDate), 'day'))

        const dismissItems = document.querySelectorAll('[aria-label="dismissible-edit-item"]')
        if (e.key === '+' && dismissItems.length === 0 && !isInputsFocused() && shouldOpen) {
            e.preventDefault()
            e.stopPropagation()
            newItemRef.current.toggleModal()
        }
    }

    const tryExpandTasksListInGoalWhenAddTask = task => {
        const { dueDate } = task
        if (goalOpenTasksExpandState !== GOAL_OPEN_TASKS_EXPANDED_SOMEDAY) {
            const taskInBacklog = dueDate === BACKLOG_DATE_NUMERIC
            if (taskInBacklog) {
                dispatch(setGoalOpenTasksExpandState(GOAL_OPEN_TASKS_EXPANDED_SOMEDAY))
            } else if (
                goalOpenTasksData.length > 0 &&
                goalOpenTasksExpandState !== GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS &&
                goalOpenTasksData[0][DATE_TASK_INDEX] !== moment(dueDate).format('YYYYMMDD')
            ) {
                dispatch(setGoalOpenTasksExpandState(GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS))
            }
        }

        const { loggedUser } = store.getState()

        if (
            goalOpenTasksData.length > 0 &&
            goalOpenTasksData[0][DATE_TASK_INDEX] === moment(dueDate).format('YYYYMMDD') &&
            loggedUser.numberTodayTasks > 0 &&
            loggedUser.numberTodayTasks < goalOpenTasksData[0][MAIN_TASK_INDEX].length &&
            ProjectHelper.getTypeOfProject(loggedUser, projectId) === PROJECT_TYPE_TEMPLATE
        ) {
            dispatch(setGoalOpenMainTasksExpanded(true))
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

    return (
        <View style={localStyles.container}>
            <DismissibleItem
                ref={newItemRef}
                defaultComponent={
                    <AddTask
                        projectId={projectId}
                        tags={[]}
                        toggleModal={() => {
                            newItemRef?.current?.toggleModal()
                        }}
                        newItem={true}
                        hideParentGoalButton={true}
                        dateFormated={dateFormated}
                    />
                }
                modalComponent={
                    <EditTask
                        adding={true}
                        projectId={projectId}
                        onCancelAction={() => {
                            newItemRef?.current?.toggleModal()
                        }}
                        defaultDate={date.valueOf()}
                        inBacklog={dateFormated === BACKLOG_DATE_STRING}
                        activeGoal={goal}
                        tryExpandTasksListInGoalWhenAddTask={tryExpandTasksListInGoalWhenAddTask}
                        dateFormated={dateFormated}
                        useLoggedUser={true}
                    />
                }
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 8,
    },
})
