import React, { useEffect } from 'react'
import { DragDropContext } from 'react-beautiful-dnd'
import { useSelector, useDispatch } from 'react-redux'
import moment from 'moment'

import GoalOpenTasksMainSection from './GoalOpenTasksMainSection'
import OpenGoalTasksSuggestedSectionList from './OpenGoalTasksSuggestedSectionList'
import GoalOpenTasksMentionSection from './GoalOpenTasksMentionSection'
import GoalOpenTasksEmailSection from './GoalOpenTasksEmailSection'
import GoalOpenTasksCalendarSection from './GoalOpenTasksCalendarSection'
import {
    CALENDAR_TASK_INDEX,
    DATE_TASK_INDEX,
    EMAIL_TASK_INDEX,
    MAIN_TASK_INDEX,
    MENTION_TASK_INDEX,
    SUGGESTED_TASK_INDEX,
} from '../../../utils/backends/Tasks/openGoalTasks'
import { removeActiveDragTaskModeInDate, setSelectedTasks } from '../../../redux/actions'
import { taskMatchHashtagFilters } from '../../HashtagFilters/FilterHelpers/FilterTasks'

export default function GoalOpenTasksSections({ tasksData, projectId, dateIndex, goal }) {
    const dispatch = useDispatch()
    const activeDragTaskModeInDate = useSelector(state => state.activeDragTaskModeInDate)
    const hashtagFilters = useSelector(state => state.hashtagFilters) //NEEDED FOR FORCE A RENDER

    const dateFormated = tasksData[DATE_TASK_INDEX]
    const mainasksAmount = tasksData[MAIN_TASK_INDEX].length
    const mentionTasksAmount = tasksData[MENTION_TASK_INDEX].length
    const suggestedTasksSectionsAmount = tasksData[SUGGESTED_TASK_INDEX].length
    const calendarTasksAmount = tasksData[CALENDAR_TASK_INDEX].length
    const emailTasksAmount = tasksData[EMAIL_TASK_INDEX].length

    const isActiveOrganizeMode =
        activeDragTaskModeInDate &&
        activeDragTaskModeInDate.projectId === projectId &&
        activeDragTaskModeInDate.dateIndex === dateIndex

    useEffect(() => {
        return () => {
            dispatch(removeActiveDragTaskModeInDate())
            dispatch(setSelectedTasks(null, true))
        }
    }, [])

    const isToday = dateFormated === moment().format('YYYYMMDD')

    return (
        <DragDropContext onDragEnd={() => {}} onBeforeCapture={() => {}}>
            {(isToday || mainasksAmount) > 0 && (
                <GoalOpenTasksMainSection
                    mainTasks={tasksData[MAIN_TASK_INDEX].filter(item => taskMatchHashtagFilters(item))}
                    projectId={projectId}
                    dateIndex={dateIndex}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                    goal={goal}
                    dateFormated={dateFormated}
                />
            )}

            {mentionTasksAmount > 0 && (
                <GoalOpenTasksMentionSection
                    mentionTasks={tasksData[MENTION_TASK_INDEX].filter(item => taskMatchHashtagFilters(item))}
                    projectId={projectId}
                    dateIndex={dateIndex}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
            {suggestedTasksSectionsAmount > 0 && (
                <OpenGoalTasksSuggestedSectionList
                    suggestedTasks={tasksData[SUGGESTED_TASK_INDEX].filter(item => taskMatchHashtagFilters(item))}
                    projectId={projectId}
                    dateIndex={dateIndex}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
            {calendarTasksAmount > 0 && (
                <GoalOpenTasksCalendarSection
                    calendarTasks={tasksData[CALENDAR_TASK_INDEX].filter(item => taskMatchHashtagFilters(item))}
                    projectId={projectId}
                    dateIndex={dateIndex}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
            {emailTasksAmount > 0 && (
                <GoalOpenTasksEmailSection
                    emailTasks={tasksData[EMAIL_TASK_INDEX].filter(item => taskMatchHashtagFilters(item))}
                    projectId={projectId}
                    dateIndex={dateIndex}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                />
            )}
        </DragDropContext>
    )
}
