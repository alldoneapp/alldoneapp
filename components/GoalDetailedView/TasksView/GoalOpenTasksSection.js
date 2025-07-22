import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import moment from 'moment'

import OpenGoalTasksByDate from './OpenGoalTasksByDate'
import { DATE_TASK_INDEX, MAIN_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import AddTaskTag from '../../Tags/AddTaskTag'
import { FEED_GOAL_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import SharedHelper from '../../../utils/SharedHelper'
import { BACKLOG_DATE_NUMERIC, BACKLOG_DATE_STRING } from '../../TaskListView/Utils/TasksHelper'
import { setGoalOpenMainTasksExpanded, setGoalOpenTasksExpandState } from '../../../redux/actions'
import {
    GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY,
    GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS,
    GOAL_OPEN_TASKS_EXPANDED_SOMEDAY,
} from '../../GoalsView/GoalsHelper'
import { PROJECT_TYPE_TEMPLATE } from '../../SettingsView/ProjectsSettings/ProjectsSettings'

export default function GoalOpenTasksSection({ projectId, goal }) {
    const dispatch = useDispatch()
    let goalOpenTasksData = useSelector(state => state.goalOpenTasksData)
    const loggedUser = useSelector(state => state.loggedUser)
    const goalOpenTasksExpandState = useSelector(state => state.goalOpenTasksExpandState)

    const areTasksInToday =
        goalOpenTasksData.length > 0 && goalOpenTasksData[0][DATE_TASK_INDEX] === moment().format('YYYYMMDD')

    if (!areTasksInToday)
        goalOpenTasksData = [[moment().format('YYYYMMDD'), 0, 0, [], [], [], [], []], ...goalOpenTasksData]

    const loggedUserCanUpdateObject =
        loggedUser.uid === goal.ownerId || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

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

    const updateExpandedState = () => {
        if (goalOpenTasksData.length > 0) {
            const firstDate = goalOpenTasksData[0][DATE_TASK_INDEX]
            if (
                goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY ||
                goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS
            ) {
                if (firstDate === BACKLOG_DATE_STRING)
                    dispatch(setGoalOpenTasksExpandState(GOAL_OPEN_TASKS_EXPANDED_SOMEDAY))
            }
        }
    }

    useEffect(() => {
        updateExpandedState()
    }, [goalOpenTasksData])

    useEffect(() => {
        return () => {
            dispatch(setGoalOpenTasksExpandState(GOAL_OPEN_TASKS_EXPANDED_SOMEDAY))
        }
    }, [])

    const goalOpenTasksDataToShow =
        goalOpenTasksData.length > 0
            ? goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY
                ? [goalOpenTasksData[0]]
                : goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS
                ? goalOpenTasksData.filter(tasksData => tasksData[DATE_TASK_INDEX] !== BACKLOG_DATE_STRING)
                : goalOpenTasksData
            : []

    return (
        <>
            {accessGranted && loggedUserCanUpdateObject && (
                <View style={localStyles.addTaskContainer}>
                    <AddTaskTag
                        projectId={projectId}
                        sourceType={FEED_GOAL_OBJECT_TYPE}
                        objectId={goal.id}
                        sourceIsPublicFor={goal.isPublicFor}
                        lockKey={goal.lockKey || ''}
                        tryExpandTasksListInGoalWhenAddTask={tryExpandTasksListInGoalWhenAddTask}
                        useLoggedUser={true}
                    />
                </View>
            )}
            <View style={{ marginBottom: 32 }}>
                {goalOpenTasksDataToShow.map((tasksData, index) => {
                    const showLaterTasksButton =
                        (goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY &&
                            goalOpenTasksData.length > 1) ||
                        (goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS &&
                            goalOpenTasksData.length > goalOpenTasksDataToShow.length &&
                            goalOpenTasksDataToShow.length - 1 === index)
                    const hideLaterTasksButton =
                        (goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS ||
                            goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_SOMEDAY) &&
                        goalOpenTasksDataToShow.length > 1 &&
                        (index === 0 || index === goalOpenTasksDataToShow.length - 1)
                    return (
                        <OpenGoalTasksByDate
                            key={tasksData[DATE_TASK_INDEX]}
                            projectId={projectId}
                            tasksData={tasksData}
                            goal={goal}
                            dateIndex={index}
                            showLaterTasksButton={showLaterTasksButton}
                            hideLaterTasksButton={hideLaterTasksButton}
                        />
                    )
                })}
            </View>
        </>
    )
}

const localStyles = StyleSheet.create({
    addTaskContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 14,
    },
})
