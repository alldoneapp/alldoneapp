import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { cloneDeep } from 'lodash'
import { useSelector } from 'react-redux'

import ProjectHeader from '../Header/ProjectHeader'
import PendingTasksByDate from '../PendingTasksView/PendingTasksByDate'
import { watchTasksInWorkflow, unwatchTasksInWorkflow } from '../../../utils/backends/workflowTasks'
import { filterPendingTasks } from '../../HashtagFilters/FilterHelpers/FilterTasks'
import useSelectorHashtagFilters from '../../HashtagFilters/UseSelectorHashtagFilters'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import useShowNewCommentsBubbleInBoard from '../../../hooks/Chats/useShowNewCommentsBubbleInBoard'

export default function PendingTasksByProject({ project, inSelectedProject }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [filters, filtersArray] = useSelectorHashtagFilters()
    const [tasksByDateAndStep, setTasksByDateAndStep] = useState([])
    const [filteredTasksByDateAndStep, setFilteredTasksByDateAndStep] = useState(cloneDeep(tasksByDateAndStep))
    const [subtaskByTask, setSubtaskByTask] = useState({})
    const [estimationByDate, setEstimationByDate] = useState({})
    const [amountOfTasksByDate, setAmountOfTasksByDate] = useState({})
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

    const updateTasks = (tasksByDateAndStep, estimationValue, amountOfTasksByDate) => {
        setTasksByDateAndStep(tasksByDateAndStep)
        setEstimationByDate(estimationValue)
        setAmountOfTasksByDate(amountOfTasksByDate)
    }

    useEffect(() => {
        watchTasksInWorkflow(project.id, updateTasks, setSubtaskByTask)
        return () => {
            unwatchTasksInWorkflow(project.id)
        }
    }, [])

    useEffect(() => {
        if (filtersArray.length > 0) {
            const newTasksByDateAndStep = filterPendingTasks(tasksByDateAndStep)
            setFilteredTasksByDateAndStep(newTasksByDateAndStep)
        } else {
            setFilteredTasksByDateAndStep(cloneDeep(tasksByDateAndStep))
        }
        // Using plain "filtersArray" adds infinite re-renders here
    }, [JSON.stringify(filtersArray), tasksByDateAndStep])

    return filteredTasksByDateAndStep.length > 0 || inSelectedProject ? (
        <View style={localStyles.container}>
            {!isAnonymous && inSelectedProject && isUsingDefaultProjectAssistant && (
                <View style={{ marginTop: 16 }}>
                    <AssistantLine />
                </View>
            )}
            <ProjectHeader projectIndex={project.index} projectId={project.id} showWorkflowTag={true} />
            {!isAnonymous && inSelectedProject && !isUsingDefaultProjectAssistant && <AssistantLine />}
            {filteredTasksByDateAndStep.map((item, index) => {
                const dateFormated = item[0]
                const tasksByStep = item[1]
                const firstDateSection = index === 0
                const estimation = estimationByDate[dateFormated]
                const amountTasks = amountOfTasksByDate[dateFormated]
                return (
                    <View key={dateFormated}>
                        <PendingTasksByDate
                            project={project}
                            dateFormated={dateFormated}
                            firstDateSection={firstDateSection}
                            tasksByStep={tasksByStep}
                            subtaskByTask={subtaskByTask}
                            estimation={estimation}
                            amountTasks={amountTasks}
                        />
                    </View>
                )
            })}
        </View>
    ) : showFollowedBubble || showUnfollowedBubble ? (
        <View style={localStyles.container}>
            <ProjectHeader projectIndex={project.index} projectId={project.id} showWorkflowTag={true} />
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 24,
    },
})
