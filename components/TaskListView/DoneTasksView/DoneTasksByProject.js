import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { cloneDeep } from 'lodash'
import { useSelector, useDispatch } from 'react-redux'

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
import { setAmountTasksExpanded } from '../../../redux/actions'
import { AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON } from '../../../utils/backends/doneTasks'

export default function DoneTasksByProject({ project, inSelectedProject }) {
    const dispatch = useDispatch()
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const doneTasksAmount = useSelector(state => state.doneTasksAmount)
    const amountDoneTasksExpanded = useSelector(state => state.amountDoneTasksExpanded)
    const [filteredTasksByDate, setFilteredTasksByDate] = useState([])
    const [filters, filtersArray] = useSelectorHashtagFilters()
    const { showFollowedBubble, showUnfollowedBubble } = useShowNewCommentsBubbleInBoard(project.id)

    // Check if this project is using the default project's assistant
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)
    const projectAssistants = useSelector(state => state.projectAssistants?.[project.id] || [])
    const globalAssistants = useSelector(state => state.globalAssistants || [])
    const isUsingDefaultProjectAssistant = (() => {
        if (project.id === defaultProjectId || !defaultProjectId) return false
        if (!project?.assistantId) return true
        const isLocalProjectAssistant = projectAssistants.some(a => a.uid === project.assistantId)
        const isGlobalInProject =
            project.globalAssistantIds?.includes(project.assistantId) &&
            globalAssistants.some(a => a.uid === project.assistantId)
        return !isLocalProjectAssistant && !isGlobalInProject
    })()

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

    // Auto-expand earlier tasks if there are no tasks today in the selected project view
    useEffect(() => {
        if (inSelectedProject && amountDoneTasksExpanded === 0 && doneTasksAmount !== null && doneTasksAmount === 0) {
            dispatch(setAmountTasksExpanded(AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON))
        }
    }, [inSelectedProject, amountDoneTasksExpanded, doneTasksAmount])

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
            {!isAnonymous && inSelectedProject && isUsingDefaultProjectAssistant && (
                <View style={{ marginTop: 16 }}>
                    <AssistantLine />
                </View>
            )}
            <ProjectHeader projectIndex={project.index} projectId={project.id} showWorkflowTag={true} />
            {!isAnonymous && inSelectedProject && !isUsingDefaultProjectAssistant && <AssistantLine />}
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
