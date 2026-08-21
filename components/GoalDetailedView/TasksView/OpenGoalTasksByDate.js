import React from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import OpenDateHeader from './OpenDateHeader'
import {
    AMOUNT_TASKS_INDEX,
    DATE_TASK_INDEX,
    ESTIMATION_TASKS_INDEX,
} from '../../../utils/backends/Tasks/openGoalTasks'
import GoalOpenTasksSections from './GoalOpenTasksSections'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import {
    GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY,
    GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS,
    GOAL_OPEN_TASKS_EXPANDED_SOMEDAY,
} from '../../GoalsView/GoalsHelper'
import { setGoalOpenTasksExpandState } from '../../../redux/actions'
import { BACKLOG_DATE_STRING } from '../../TaskListView/Utils/TasksHelper'

export default function OpenGoalTasksByDate({
    projectId,
    tasksData,
    goal,
    dateIndex,
    showLaterTasksButton,
    hideLaterTasksButton,
}) {
    const dispatch = useDispatch()
    const goalOpenTasksExpandState = useSelector(state => state.goalOpenTasksExpandState)
    const goalOpenTasksData = useSelector(state => state.goalOpenTasksData)

    const expandTasks = () => {
        const nextDateIsSomeday =
            goalOpenTasksData.length === 2 &&
            goalOpenTasksData[goalOpenTasksData.length - 1][DATE_TASK_INDEX] === BACKLOG_DATE_STRING

        dispatch(
            setGoalOpenTasksExpandState(
                goalOpenTasksExpandState === GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY && !nextDateIsSomeday
                    ? GOAL_OPEN_TASKS_EXPANDED_LATER_DAYS
                    : GOAL_OPEN_TASKS_EXPANDED_SOMEDAY
            )
        )
    }

    const contractTasks = () => {
        dispatch(setGoalOpenTasksExpandState(GOAL_OPEN_TASKS_EXPANDED_FIRST_DAY))
    }

    return (
        <View>
            <OpenDateHeader
                dateFormated={tasksData[DATE_TASK_INDEX]}
                amountTasks={tasksData[AMOUNT_TASKS_INDEX]}
                estimation={tasksData[ESTIMATION_TASKS_INDEX]}
                projectId={projectId}
                ownerId={goal.ownerId}
                isFirstDay={dateIndex === 0}
                dateIndex={dateIndex}
            />
            <GoalOpenTasksSections tasksData={tasksData} projectId={projectId} dateIndex={dateIndex} goal={goal} />
            <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                {showLaterTasksButton && (
                    <ShowMoreButton
                        expanded={false}
                        expand={expandTasks}
                        expandText={'later tasks'}
                        style={{
                            flex: 0,
                            flexDirection: 'row',
                            justifyContent: 'center',
                            marginTop: 8,
                            marginRight: hideLaterTasksButton ? 16 : 0,
                        }}
                    />
                )}
                {hideLaterTasksButton && (
                    <ShowMoreButton
                        expanded={true}
                        contract={contractTasks}
                        contractText={'hide later tasks'}
                        style={{ flex: 0, flexDirection: 'row', justifyContent: 'center', marginTop: 8 }}
                    />
                )}
            </View>
        </View>
    )
}
