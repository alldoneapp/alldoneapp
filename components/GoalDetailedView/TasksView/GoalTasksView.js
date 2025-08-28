import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import LinkedTasksHeader from './LinkedTasksHeader'
import URLsGoals, {
    URL_GOAL_DETAILS_TASKS_DONE,
    URL_GOAL_DETAILS_TASKS_OPEN,
    URL_GOAL_DETAILS_TASKS_WORKFLOW,
} from '../../../URLSystem/Goals/URLsGoals'
import GoalTasksMultiToggleSwitch from './GoalTasksMultiToggleSwitch'
import { TOGGLE_INDEX_DONE, TOGGLE_INDEX_OPEN, TOGGLE_INDEX_PENDING } from '../../TaskListView/Utils/TasksHelper'
import { watchOpenGoalSubtasks, watchOpenGoalTasks } from '../../../utils/backends/Tasks/openGoalTasks'
import { unwatch } from '../../../utils/backends/firestore'
import {
    setGoalDoneSubtasksByParent,
    setGoalDoneTasksData,
    setGoalOpenSubtasksByParent,
    setGoalOpenTasksData,
    setGoalWorkflowSubtasksByParent,
    setGoalWorkflowTasksData,
    setTaskViewToggleIndex,
} from '../../../redux/actions'
import { watchDoneGoalSubtasks, watchDoneGoalTasks } from '../../../utils/backends/Tasks/doneGoalTasks'
import { watchWorkflowGoalSubtasks, watchWorkflowGoalTasks } from '../../../utils/backends/Tasks/workflowGoalTasks'
import GoalOpenTasksSection from './GoalOpenTasksSection'
import GoalWorkflowTasksSection from './GoalWorkflowTasksSection'
import GoalDoneTasksSection from './GoalDoneTasksSection'
import HashtagFiltersView from '../../HashtagFilters/HashtagFiltersView'

export default function GoalTasksView({ goal, projectId }) {
    const dispatch = useDispatch()
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)

    const writeBrowserURL = () => {
        const data = { projectId: projectId, goal: goal.id }
        const constant =
            taskViewToggleIndex === TOGGLE_INDEX_OPEN
                ? URL_GOAL_DETAILS_TASKS_OPEN
                : taskViewToggleIndex === TOGGLE_INDEX_PENDING
                ? URL_GOAL_DETAILS_TASKS_WORKFLOW
                : URL_GOAL_DETAILS_TASKS_DONE

        URLsGoals.push(constant, data, projectId, goal.id)
    }

    useEffect(() => {
        writeBrowserURL()
    }, [projectId, goal.id, taskViewToggleIndex])

    useEffect(() => {
        dispatch(setTaskViewToggleIndex(0))
    }, [])

    useEffect(() => {
        const openTasksWatcherKey = v4()
        const openSubtasksWatcherKey = v4()
        watchOpenGoalTasks(projectId, goal.id, openTasksWatcherKey)
        watchOpenGoalSubtasks(projectId, goal.id, openSubtasksWatcherKey)

        const workflowTasksWatcherKey = v4()
        const workflowSubtasksWatcherKey = v4()
        watchWorkflowGoalTasks(projectId, goal.id, workflowTasksWatcherKey)
        watchWorkflowGoalSubtasks(projectId, goal.id, workflowSubtasksWatcherKey)

        const doneTasksWatcherKey = v4()
        const doneSubtasksWatcherKey = v4()
        watchDoneGoalTasks(projectId, goal.id, doneTasksWatcherKey)
        watchDoneGoalSubtasks(projectId, goal.id, doneSubtasksWatcherKey)

        return () => {
            unwatch(openTasksWatcherKey)
            unwatch(openSubtasksWatcherKey)
            unwatch(workflowTasksWatcherKey)
            unwatch(workflowSubtasksWatcherKey)
            unwatch(doneTasksWatcherKey)
            unwatch(doneSubtasksWatcherKey)
            dispatch([
                setGoalOpenTasksData([]),
                setGoalOpenSubtasksByParent([]),
                setGoalWorkflowTasksData([]),
                setGoalWorkflowSubtasksByParent([]),
                setGoalDoneTasksData([]),
                setGoalDoneSubtasksByParent([]),
            ])
        }
    }, [projectId, goal.id])

    return (
        <View>
            <LinkedTasksHeader />
            <GoalTasksMultiToggleSwitch />
            <HashtagFiltersView handleSpaces={false} />
            {taskViewToggleIndex === TOGGLE_INDEX_OPEN && <GoalOpenTasksSection projectId={projectId} goal={goal} />}
            {taskViewToggleIndex === TOGGLE_INDEX_PENDING && <GoalWorkflowTasksSection projectId={projectId} />}
            {taskViewToggleIndex === TOGGLE_INDEX_DONE && <GoalDoneTasksSection projectId={projectId} />}
        </View>
    )
}
