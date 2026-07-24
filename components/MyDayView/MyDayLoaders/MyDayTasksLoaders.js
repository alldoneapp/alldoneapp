import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import store from '../../../redux/store'
import MyDayTasksProjectLoaders from './MyDayTasksProjectLoaders'
import {
    clearMyDayAllTodayTasks,
    clearMyDayAllWorkflowTtasks,
    clearMyDayAllDoneTtasks,
    setMyDaySelectedAndOtherTasks,
    clearAllOpenTasksShowMoreData,
} from '../../../redux/actions'
import {
    TIME_FOR_CHECK_ACTIVE_TASK_ESTIMATION,
    processTaskEstimationWhenTimePass,
    selectTasksAndAddTimeIntervale,
} from '../MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'

export default function MyDayTasksLoaders() {
    const dispatch = useDispatch()
    const openTasksLoaded = useSelector(state => state.myDayAllTodayTasks.loaded)
    const projectIds = useSelector(state => state.loggedUser.projectIds)
    const activeTaskStartingDate = useSelector(state => state.loggedUser.activeTaskStartingDate)
    const [projectsToLoadIds, setProjectsToLoadIds] = useState([])

    useEffect(() => {
        const { loggedUser, loggedUserProjectsMap } = store.getState()
        const { guideProjectIds, archivedProjectIds, templateProjectIds } = loggedUser

        const sortedLoggedUserProjectIds = ProjectHelper.getNormalAndGuideProjects(
            projectIds,
            guideProjectIds,
            archivedProjectIds,
            templateProjectIds,
            loggedUserProjectsMap
        )

        setProjectsToLoadIds(sortedLoggedUserProjectIds)
    }, [projectIds])

    const updateSelectedTasks = () => {
        const { loggedUser, myDaySelectedTasks, myDayOtherTasks, loggedUserProjectsMap } = store.getState()

        const {
            selectedTasks,
            otherTasks,
            selectedTasksForSortingMode,
            otherTasksForSortingMode,
        } = selectTasksAndAddTimeIntervale(
            [...myDaySelectedTasks, ...myDayOtherTasks],
            loggedUser,
            loggedUserProjectsMap
        )

        dispatch(
            setMyDaySelectedAndOtherTasks(
                selectedTasks,
                otherTasks,
                selectedTasksForSortingMode,
                otherTasksForSortingMode
            )
        )
    }

    useEffect(() => {
        updateSelectedTasks()
    }, [activeTaskStartingDate])

    useEffect(() => {
        if (openTasksLoaded) {
            const intervalId = setInterval(processTaskEstimationWhenTimePass, TIME_FOR_CHECK_ACTIVE_TASK_ESTIMATION)
            return () => {
                clearInterval(intervalId)
            }
        }
    }, [openTasksLoaded])

    useEffect(() => {
        if (openTasksLoaded) {
            const intervalId = setInterval(updateSelectedTasks, TIME_FOR_CHECK_ACTIVE_TASK_ESTIMATION)
            return () => {
                clearInterval(intervalId)
            }
        }
    }, [openTasksLoaded])

    useEffect(() => {
        return () => {
            dispatch([clearMyDayAllTodayTasks(), clearMyDayAllWorkflowTtasks(), clearMyDayAllDoneTtasks()])
        }
    }, [])

    useEffect(() => {
        return () => {
            dispatch(clearAllOpenTasksShowMoreData())
        }
    }, [])

    return (
        <View>
            {projectsToLoadIds.map(projectId => {
                return <MyDayTasksProjectLoaders key={projectId} projectId={projectId} />
            })}
        </View>
    )
}
