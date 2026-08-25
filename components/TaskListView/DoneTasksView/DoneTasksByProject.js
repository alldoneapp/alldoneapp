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
import { useProjectAssistantLine } from '../../MyDayView/AssistantLine/useAssistantLineSwitch'
import { setAmountTasksExpanded } from '../../../redux/actions'
import { AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON } from '../../../utils/backends/doneTasks'
import TaskListSkeleton from '../TaskListSkeleton'
import { resolveGhostRowCount } from '../../UIComponents/Ghosts/ghostRowCount'

export default function DoneTasksByProject({ project, inSelectedProject }) {
    const dispatch = useDispatch()
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const doneTasksAmount = useSelector(state => state.doneTasksAmount)
    const amountDoneTasksExpanded = useSelector(state => state.amountDoneTasksExpanded)
    const [filteredTasksByDate, setFilteredTasksByDate] = useState([])
    const [filters, filtersArray] = useSelectorHashtagFilters()

    // AT-2430: assistant resolution + switch options, shared with the open/pending boards of the
    // same project so all three tabs can never show a different assistant.
    const { hasAssistantLine, assistantLineProps } = useProjectAssistantLine(project)
    const showAssistantLine = !isAnonymous && inSelectedProject && hasAssistantLine

    const { todayTasksByDate, todaySubtasksByTask, todayEstimationByDate } = useTodayTasks(project)
    const { earlierTasksByDate, earlierEstimationByDate, earlierCompletedDateToCheck, loadingEarlierTasks } =
        useEarlierTasks(project, doneTasksAmount + amountDoneTasksExpanded)

    const completedDateToCheck =
        amountDoneTasksExpanded > 0 ? earlierCompletedDateToCheck : moment().startOf('day').valueOf()
    const earlierSubtasksByTask = useEarlierSubtasks(project, completedDateToCheck)

    // AT-2382 - the first "earlier tasks" press is the harsh one: `tasksByDate` switches
    // from today's list to `earlierTasksByDate`, which is still `[]` until Firestore
    // answers, so the section previously went completely blank. Later presses keep the
    // rows they already have, so the ghosts then simply extend the list downwards.
    const showEarlierTasksGhosts = amountDoneTasksExpanded > 0 && loadingEarlierTasks

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
            <ProjectHeader
                projectIndex={project.index}
                projectId={project.id}
                showWorkflowTag={true}
                showRootSectionNavigation={inSelectedProject}
            />
            {showAssistantLine && (
                <View style={[localStyles.lastCommentContainer, localStyles.lastCommentContainerNoTopMargin]}>
                    <AssistantLine {...assistantLineProps} />
                </View>
            )}
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

            {showEarlierTasksGhosts && (
                <TaskListSkeleton
                    rowCount={resolveGhostRowCount(AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON)}
                    showDateHeader={filteredTasksByDate.length === 0}
                />
            )}

            <ShowMoreButtonsArea
                filteredTasksByDateAmount={filteredTasksByDate.length}
                projectId={project.id}
                projectIndex={project.index}
                completedDateToCheck={completedDateToCheck}
                loading={showEarlierTasksGhosts}
            />
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
    lastCommentContainer: {
        marginTop: 12,
    },
    lastCommentContainerNoTopMargin: {
        marginTop: 0,
    },
})
