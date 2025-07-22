import React from 'react'
import { View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import DateHeader from '../Header/DateHeader'
import SendToSection from './SentToSection'
import TasksHelper from '../Utils/TasksHelper'
import { taskMatchHashtagFilters } from '../../HashtagFilters/FilterHelpers/FilterTasks'

export default function PendingTasksByDate({
    tasksByStep,
    subtaskByTask,
    project,
    firstDateSection,
    dateFormated,
    estimation,
    amountTasks,
}) {
    const route = useSelector(state => state.route)
    const hashtagFilters = useSelector(state => state.hashtagFilters) //NEEDED FOR FORCE A RENDER

    const projectId = project.id

    const date = moment(dateFormated, 'YYYYMMDD')
    const isToday = date.isSame(moment(), 'day')

    const getStepData = (tasks, stepId) => {
        const assigneeId = tasks[0].userId
        const assignee = TasksHelper.getUserInProject(projectId, assigneeId)
        return { currentStep: assignee.workflow[projectId][stepId], assignee }
    }

    return (
        <View>
            <DateHeader
                dateText={date.calendar(null, {
                    sameDay: '[TODAY]',
                    nextDay: '[TOMORROW]',
                    lastDay: '[YESTERDAY]',
                    nextWeek: 'YYYY/MM/DD',
                    lastWeek: 'YYYY/MM/DD',
                    sameElse: 'YYYY/MM/DD',
                })}
                isToday={isToday}
                estimation={estimation}
                date={date}
                amountTasks={amountTasks}
                firstDateSection={firstDateSection}
                projectId={projectId}
            />

            {tasksByStep.map(item => {
                const currentStepId = item[0]
                const taskList = item[1]
                const { currentStep, assignee } = getStepData(taskList, currentStepId)
                return currentStep ? (
                    <SendToSection
                        key={currentStepId}
                        taskList={
                            route === 'GoalDetailedView'
                                ? taskList.filter(item => taskMatchHashtagFilters(item))
                                : taskList
                        }
                        projectId={projectId}
                        currentStepId={currentStepId}
                        subtaskByTask={subtaskByTask}
                        currentStep={currentStep}
                        assignee={assignee}
                    />
                ) : null
            })}
        </View>
    )
}
