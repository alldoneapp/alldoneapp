import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector, shallowEqual, useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import ProjectHeader from '../Header/ProjectHeader'
import OpenTasksByDate from '../OpenTasksView/OpenTasksByDate'
import { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { DATE_TASK_INDEX, watchAllGoals, watchAllMilestones } from '../../../utils/backends/openTasks'
import NeedShowMoreOpenTasksButton from './NeedShowMoreOpenTasksButton'
import NeedShowMoreEmptyGoalsButton from './NeedShowMoreEmptyGoalsButton'
import OpenTasksByProjectHandler from './OpenTasksByProjectHandler'
import BottomShowMoreButtonContainer from './BottomShowMoreButtonContainer'
import Backend from '../../../utils/BackendBridge'
import {
    setTasksArrowButtonIsExpanded,
    setDoneMilestonesInProjectInTasks,
    setGoalsInProjectInTasks,
    setOpenMilestonesInProjectInTasks,
} from '../../../redux/actions'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import useShowNewCommentsBubbleInBoard from '../../../hooks/Chats/useShowNewCommentsBubbleInBoard'
import OpenTasksEmptyProject from './OpenTasksEmptyProject/OpenTasksEmptyProject'

export default function OpenTasksByProject({
    firstProject,
    setProjectsHaveTasksInFirstDay,
    sortedLoggedUserProjectIds,
    projectId,
}) {
    const dispatch = useDispatch()
    const projectIndex = useSelector(state => state.loggedUserProjectsMap[projectId]?.index)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const isAssistant = useSelector(state => !!state.currentUser.temperature)
    const tasksArrowButtonIsExpanded = useSelector(state => state.tasksArrowButtonIsExpanded)
    const [pressedShowMoreMainSection, setPressedShowMoreMainSection] = useState(false)
    const { showFollowedBubble, showUnfollowedBubble } = useShowNewCommentsBubbleInBoard(projectId)

    const instanceKey = projectId + currentUserId

    const filteredOpenTasksDates = useSelector(
        state =>
            state.filteredOpenTasksStore[instanceKey]
                ? state.filteredOpenTasksStore[instanceKey].map(tasksByDate => tasksByDate[DATE_TASK_INDEX])
                : [],
        shallowEqual
    )
    const thereAreNotTasksInFirstDay = useSelector(state =>
        state.thereAreNotTasksInFirstDay[instanceKey] ? state.thereAreNotTasksInFirstDay[instanceKey] : false
    )

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    const hideProjectData = !inSelectedProject && (thereAreNotTasksInFirstDay || filteredOpenTasksDates.length == 0)

    // Check if this project is using the default project's assistant
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)
    const isUsingDefaultProjectAssistant = !project?.assistantId && projectId !== defaultProjectId && defaultProjectId

    useEffect(() => {
        const watcherKey = v4()
        watchAllMilestones(projectId, watcherKey)
        return () => {
            Backend.unwatch(watcherKey)
            dispatch([
                setOpenMilestonesInProjectInTasks(projectId, null),
                setDoneMilestonesInProjectInTasks(projectId, null),
            ])
        }
    }, [projectId])

    useEffect(() => {
        const watcherKey = v4()
        watchAllGoals(projectId, watcherKey)
        return () => {
            Backend.unwatch(watcherKey)
            dispatch(setGoalsInProjectInTasks(projectId, null))
        }
    }, [projectId])

    useEffect(() => {
        if (currentUserId) {
            setPressedShowMoreMainSection(tasksArrowButtonIsExpanded)
            if (tasksArrowButtonIsExpanded) {
                dispatch(setTasksArrowButtonIsExpanded(false))
            }
        }
    }, [currentUserId, projectId])

    return (
        <>
            <OpenTasksByProjectHandler
                projectIndex={projectIndex}
                firstProject={firstProject}
                setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
            />
            {hideProjectData && (showFollowedBubble || showUnfollowedBubble) && (
                <OpenTasksEmptyProject
                    projectId={projectId}
                    projectIndex={projectIndex}
                    setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                />
            )}
            {!hideProjectData && (
                <View style={{ marginBottom: inSelectedProject ? 32 : 25 }}>
                    <NeedShowMoreOpenTasksButton projectId={projectId} />
                    <NeedShowMoreEmptyGoalsButton projectId={projectId} />
                    {!isAnonymous && inSelectedProject && isUsingDefaultProjectAssistant && (
                        <View style={{ marginTop: 16 }}>
                            <AssistantLine />
                        </View>
                    )}
                    <ProjectHeader
                        projectIndex={projectIndex}
                        projectId={projectId}
                        showWorkflowTag={!isAssistant}
                        showAddTask={!isAssistant}
                        setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                    />
                    {!isAnonymous && inSelectedProject && !isUsingDefaultProjectAssistant && <AssistantLine />}
                    {filteredOpenTasksDates.map((dateFormated, index) => {
                        return (
                            <OpenTasksByDate
                                key={dateFormated}
                                projectId={projectId}
                                projectIndex={projectIndex}
                                dateIndex={index}
                                instanceKey={instanceKey}
                                sortedLoggedUserProjectIds={sortedLoggedUserProjectIds}
                                setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                                pressedShowMoreMainSection={pressedShowMoreMainSection}
                                setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                            />
                        )
                    })}
                    {inSelectedProject && (
                        <BottomShowMoreButtonContainer
                            instanceKey={instanceKey}
                            projectIndex={projectIndex}
                            setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                        />
                    )}
                </View>
            )}
        </>
    )
}
