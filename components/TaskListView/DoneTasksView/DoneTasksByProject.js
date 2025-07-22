import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { cloneDeep } from 'lodash'
import { useSelector } from 'react-redux'

import ProjectHeader from '../Header/ProjectHeader'
import DoneTasksByDate from '../DoneTasksView/DoneTasksByDate'
import { filterDoneTasks } from '../../HashtagFilters/FilterHelpers/FilterTasks'
import useSelectorHashtagFilters from '../../HashtagFilters/UseSelectorHashtagFilters'
import useTodayTasks from './useTodayTasks'
import useEarlierTasks from './useEarlierTasks'
import ShowMoreButtonsArea from './ShowMoreButtonsArea'
import useEarlierSubtasks from './useEarlierSubtasks'
import moment from 'moment'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import useShowNewCommentsBubbleInBoard from '../../../hooks/Chats/useShowNewCommentsBubbleInBoard'

export default function DoneTasksByProject({ project, inSelectedProject }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const doneTasksAmount = useSelector(state => state.doneTasksAmount)
    const amountDoneTasksExpanded = useSelector(state => state.amountDoneTasksExpanded)
    const [filteredTasksByDate, setFilteredTasksByDate] = useState([])
    const [filters, filtersArray] = useSelectorHashtagFilters()
    const { showFollowedBubble, showUnfollowedBubble } = useShowNewCommentsBubbleInBoard(project.id)

    const { todayTasksByDate, todaySubtasksByTask, todayEstimationByDate } = useTodayTasks(project)
    const { earlierTasksByDate, earlierEstimationByDate, earlierCompletedDateToCheck } = useEarlierTasks(
        project,
        doneTasksAmount + amountDoneTasksExpanded
    )

    const completedDateToCheck =
        amountDoneTasksExpanded > 0 ? earlierCompletedDateToCheck : moment().startOf('day').valueOf()
    const earlierSubtasksByTask = useEarlierSubtasks(project, completedDateToCheck)

    const tasksByDate = amountDoneTasksExpanded > 0 ? earlierTasksByDate : todayTasksByDate
    const estimationByDate = amountDoneTasksExpanded > 0 ? earlierEstimationByDate : todayEstimationByDate
    const subtaskByTask = amountDoneTasksExpanded > 0 ? earlierSubtasksByTask : todaySubtasksByTask

    useEffect(() => {
        if (filtersArray.length > 0) {
            const newDoneTasks = filterDoneTasks(tasksByDate)
            setFilteredTasksByDate(newDoneTasks)
        } else {
            setFilteredTasksByDate(cloneDeep(tasksByDate))
        }
    }, [JSON.stringify(filtersArray), tasksByDate])

    return filteredTasksByDate.length > 0 || inSelectedProject ? (
        <View style={localStyles.container}>
            <ProjectHeader projectIndex={project.index} projectId={project.id} showWorkflowTag={true} />
            {!isAnonymous && inSelectedProject && <AssistantLine />}
            {filteredTasksByDate.map((item, index) => {
                const dateFormated = item[0]
                const taskList = item[1]
                const firstDateSection = index === 0

                return (
                    <DoneTasksByDate
                        key={dateFormated}
                        projectId={project.id}
                        taskList={taskList}
                        dateFormated={dateFormated}
                        firstDateSection={firstDateSection}
                        subtaskByTask={subtaskByTask}
                        estimation={estimationByDate[dateFormated]}
                    />
                )
            })}

            <ShowMoreButtonsArea
                filteredTasksByDateAmount={filteredTasksByDate.length}
                projectId={project.id}
                projectIndex={project.index}
                completedDateToCheck={completedDateToCheck}
            />
        </View>
    ) : showFollowedBubble || showUnfollowedBubble ? (
        <View style={localStyles.container}>
            <ProjectHeader projectIndex={project.index} projectId={project.id} showWorkflowTag={true} />
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
})
