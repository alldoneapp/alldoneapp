import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'
import moment from 'moment'

import MilestonesListByProject from './MilestonesListByProject'
import { getOwnerId, GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import {
    setDoneMilestonesInProject,
    setGoalsInProject,
    setOpenMilestonesInProject,
    startLoadingData,
    stopLoadingData,
} from '../../redux/actions'
import URLsGoals, { URL_ALL_PROJECTS_GOALS_DONE, URL_ALL_PROJECTS_GOALS_OPEN } from '../../URLSystem/Goals/URLsGoals'

import EmptyGoalsAllProjects from './EmptyGoalsAllProjects'
import Backend from '../../utils/BackendBridge'
import store from '../../redux/store'
import { watchAllGoals, watchAllMilestones } from '../../utils/backends/Goals/goalsFirestore'
import { checkIfThereAreNewComments } from '../ChatsView/Utils/ChatHelper'

export default function GoalsViewAllProjects({ openEdition, closeEdition, unsetDismissibleRefs, setDismissibleRefs }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const archivedProjectIdsAmount = useSelector(state => state.loggedUser.archivedProjectIds.length)
    const templateProjectsAmount = useSelector(state => state.loggedUser.templateProjectIds.length)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const selectedTab = useSelector(state => state.selectedSidebarTab)
    const boardMilestonesByProject = useSelector(state => state.boardMilestonesByProject)
    const projectChatNotifications = useSelector(state => state.projectChatNotifications)

    const sortProjectsByMilestoneDate = () => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds, archivedProjectIds } = loggedUser
        const projects = loggedUserProjects.filter(
            project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
        )

        const normalProjects = projects.filter(project => !project.parentTemplateId)
        const guides = projects.filter(project => !!project.parentTemplateId)

        const normalProjectsSorted = []
        normalProjects.forEach(project => {
            const milestones = boardMilestonesByProject[project.id] || []
            const nextMilestoneDate = milestones.length > 0 ? milestones[0].date : moment('5000-01-01').valueOf()
            normalProjectsSorted.push({ ...project, nextMilestoneDate })
        })
        const sortedLoggedUserNormalProjects = Object.values(normalProjectsSorted).sort(
            (a, b) => (b.nextMilestoneDate - a.nextMilestoneDate) * -1
        )

        const guidesSorted = []
        guides.forEach(project => {
            const milestones = boardMilestonesByProject[project.id] || []
            const nextMilestoneDate = milestones.length > 0 ? milestones[0].date : moment('5000-01-01').valueOf()
            guidesSorted.push({ ...project, nextMilestoneDate })
        })
        const sortedLoggedUserGuides = Object.values(guidesSorted).sort(
            (a, b) => (b.nextMilestoneDate - a.nextMilestoneDate) * -1
        )

        const sortedLoggedUserProjects = [...sortedLoggedUserNormalProjects, ...sortedLoggedUserGuides]

        return sortedLoggedUserProjects
    }

    useEffect(() => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds, archivedProjectIds } = loggedUser
        const projects = loggedUserProjects.filter(
            project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
        )
        const watcherKeys = []
        projects.forEach(project => {
            const watcherKey = v4()
            watcherKeys.push(watcherKey)
            setTimeout(() => {
                dispatch(startLoadingData())
            }, 1)
            const ownerId = getOwnerId(project.id, currentUserId)
            watchAllMilestones(project.id, watcherKey, ownerId)
        })
        return () => {
            projects.forEach((project, index) => {
                Backend.unwatch(watcherKeys[index])
                dispatch([
                    stopLoadingData(),
                    setOpenMilestonesInProject(project.id, null),
                    setDoneMilestonesInProject(project.id, null),
                ])
            })
        }
    }, [loggedUserProjectsAmount, templateProjectsAmount, archivedProjectIdsAmount])

    useEffect(() => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds, archivedProjectIds } = loggedUser
        const projects = loggedUserProjects.filter(
            project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
        )
        const watcherKeys = []
        projects.forEach(project => {
            const watcherKey = v4()
            watcherKeys.push(watcherKey)
            setTimeout(() => {
                dispatch(startLoadingData())
            }, 1)
            const ownerId = getOwnerId(project.id, currentUserId)
            watchAllGoals(project.id, watcherKey, ownerId)
        })
        return () => {
            projects.forEach((project, index) => {
                Backend.unwatch(watcherKeys[index])
                dispatch([stopLoadingData(), setGoalsInProject(project.id, null)])
            })
        }
    }, [loggedUserProjectsAmount, templateProjectsAmount, archivedProjectIdsAmount])

    const writeBrowserURL = () => {
        URLsGoals.push(
            goalsActiveTab === GOALS_OPEN_TAB_INDEX ? URL_ALL_PROJECTS_GOALS_OPEN : URL_ALL_PROJECTS_GOALS_DONE,
            null
        )
    }

    useEffect(() => {
        if (processedInitialURL && selectedTab === DV_TAB_ROOT_GOALS) writeBrowserURL()
    }, [processedInitialURL, selectedProjectIndex, selectedTab, goalsActiveTab, currentUserId])

    const sortedLoggedUserProjects = sortProjectsByMilestoneDate()

    const thereAreNewComments = checkIfThereAreNewComments(
        projectChatNotifications,
        sortedLoggedUserProjects.map(project => project.id)
    )

    let firstMilestoneId = ''
    let amountOfProjectsWithMilestones = 0

    return (
        <View>
            {sortedLoggedUserProjects.map(project => {
                const boardMilestones = boardMilestonesByProject[project.id] || []
                const canShowProject = boardMilestones.length > 0
                if (canShowProject && !firstMilestoneId) firstMilestoneId = boardMilestones[0].id
                if (canShowProject) amountOfProjectsWithMilestones++

                return (
                    <MilestonesListByProject
                        key={project.id}
                        projectId={project.id}
                        projectIndex={project.index}
                        milestones={boardMilestones}
                        goalsActiveTab={goalsActiveTab}
                        firstMilestoneId={firstMilestoneId}
                        setDismissibleRefs={setDismissibleRefs}
                        unsetDismissibleRefs={unsetDismissibleRefs}
                        closeEdition={closeEdition}
                        openEdition={openEdition}
                        canShowProject={canShowProject}
                    />
                )
            })}
            {amountOfProjectsWithMilestones === 0 && !thereAreNewComments && (
                <EmptyGoalsAllProjects sortedActiveProjects={sortedLoggedUserProjects} />
            )}
        </View>
    )
}
