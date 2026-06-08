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

    // Check if this project is using a different assistant than the default project
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const defaultProject = useSelector(state => state.loggedUserProjectsMap?.[defaultProjectId])
    const isDefaultProject = project.id === defaultProjectId
    const defaultProjectAssistantId = defaultProject?.assistantId || defaultAssistant?.uid || ''
    const selectedProjectAssistantId = project?.assistantId || defaultProjectAssistantId
    const useSelectedProjectAssistantLine =
        isDefaultProject || (!!project?.assistantId && project.assistantId !== defaultProjectAssistantId)
    const assistantLineProject = useSelectedProjectAssistantLine ? project : defaultProject
    const assistantLineAssistantId = useSelectedProjectAssistantLine
        ? selectedProjectAssistantId
        : defaultProjectAssistantId
    const showAssistantSwitch =
        !isDefaultProject &&
        useSelectedProjectAssistantLine &&
        !!defaultProject &&
        !!defaultProjectAssistantId &&
        !!selectedProjectAssistantId
    const showAssistantLine = !isAnonymous && inSelectedProject && !!assistantLineProject && !!assistantLineAssistantId

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
            <ProjectHeader
                projectIndex={project.index}
                projectId={project.id}
                showWorkflowTag={true}
                showRootSectionNavigation={inSelectedProject}
            />
            {showAssistantLine && (
                <View style={[localStyles.lastCommentContainer, localStyles.lastCommentContainerNoTopMargin]}>
                    <AssistantLine
                        showLastComment={true}
                        useAssistantProjectContext={!useSelectedProjectAssistantLine}
                        useGlobalLatestComment={!useSelectedProjectAssistantLine}
                        projectOverride={assistantLineProject}
                        assistantIdOverride={assistantLineAssistantId}
                        assistantSwitchOptions={
                            showAssistantSwitch
                                ? {
                                      projectOverride: defaultProject,
                                      assistantIdOverride: defaultProjectAssistantId,
                                      useAssistantProjectContext: true,
                                      useGlobalLatestComment: true,
                                  }
                                : null
                        }
                    />
                </View>
            )}
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
            <ProjectHeader
                projectIndex={project.index}
                projectId={project.id}
                showWorkflowTag={true}
                showRootSectionNavigation={inSelectedProject}
            />
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 24,
    },
    lastCommentContainer: {
        marginTop: 12,
    },
    lastCommentContainerNoTopMargin: {
        marginTop: 0,
    },
})
