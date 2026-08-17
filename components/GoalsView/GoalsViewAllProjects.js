import React, { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'
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
import { decodeFirstBoardMilestone, selectFirstBoardMilestoneByProject } from './goalsBoardSelectors'

const NO_MILESTONE_DATE = moment('5000-01-01').valueOf()
const EMPTY_IDS = []

export const getProjectsToWatch = (loggedUserProjects, templateProjectIds, archivedProjectIds) =>
    loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

export default function GoalsViewAllProjects({ openEdition, closeEdition, unsetDismissibleRefs, setDismissibleRefs }) {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds || EMPTY_IDS)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds || EMPTY_IDS)
    const loggedUserProjectsAmount = loggedUserProjects.length
    const archivedProjectIdsAmount = archivedProjectIds.length
    const templateProjectsAmount = templateProjectIds.length
    const currentUserId = useSelector(state => state.currentUser.uid)
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const selectedTab = useSelector(state => state.selectedSidebarTab)

    // AT-2336: subscribing to the whole `boardMilestonesByProject` map re-rendered this component
    // -- and with it every project row -- once per project per Firestore snapshot. The board only
    // needs each project's first milestone (id for `firstMilestoneId`, date for ordering), so we
    // select a flat primitive map and compare it with `shallowEqual`. Each `MilestonesListByProject`
    // reads its own milestone array itself.
    const firstBoardMilestoneByProject = useSelector(selectFirstBoardMilestoneByProject, shallowEqual)

    const sortedLoggedUserProjects = useMemo(() => {
        const projects = getProjectsToWatch(loggedUserProjects, templateProjectIds, archivedProjectIds)

        const withNextMilestoneDate = project => {
            const firstMilestone = decodeFirstBoardMilestone(firstBoardMilestoneByProject[project.id])
            const nextMilestoneDate =
                firstMilestone && firstMilestone.date != null ? firstMilestone.date : NO_MILESTONE_DATE
            return { ...project, nextMilestoneDate }
        }

        const byNextMilestoneDate = (a, b) => (b.nextMilestoneDate - a.nextMilestoneDate) * -1

        const normalProjectsSorted = projects
            .filter(project => !project.parentTemplateId)
            .map(withNextMilestoneDate)
            .sort(byNextMilestoneDate)

        const guidesSorted = projects
            .filter(project => !!project.parentTemplateId)
            .map(withNextMilestoneDate)
            .sort(byNextMilestoneDate)

        return [...normalProjectsSorted, ...guidesSorted]
    }, [loggedUserProjects, templateProjectIds, archivedProjectIds, firstBoardMilestoneByProject])

    useEffect(() => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const { templateProjectIds, archivedProjectIds } = loggedUser
        const projects = getProjectsToWatch(loggedUserProjects, templateProjectIds, archivedProjectIds)
        const watcherKeys = []
        // One batched increment instead of one `setTimeout` + dispatch per project (AT-2336).
        const loadingTimeout = setTimeout(() => {
            if (projects.length > 0) dispatch(startLoadingData(projects.length))
        }, 1)
        projects.forEach(project => {
            const watcherKey = v4()
            watcherKeys.push(watcherKey)
            const ownerId = getOwnerId(project.id, currentUserId)
            watchAllMilestones(project.id, watcherKey, ownerId)
        })
        return () => {
            clearTimeout(loadingTimeout)
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
        const projects = getProjectsToWatch(loggedUserProjects, templateProjectIds, archivedProjectIds)
        const watcherKeys = []
        const loadingTimeout = setTimeout(() => {
            if (projects.length > 0) dispatch(startLoadingData(projects.length))
        }, 1)
        projects.forEach(project => {
            const watcherKey = v4()
            watcherKeys.push(watcherKey)
            const ownerId = getOwnerId(project.id, currentUserId)
            watchAllGoals(project.id, watcherKey, ownerId)
        })
        return () => {
            clearTimeout(loadingTimeout)
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

    let firstMilestoneId = ''
    let amountOfProjectsWithMilestones = 0

    return (
        <View>
            {sortedLoggedUserProjects.map(project => {
                const firstMilestone = decodeFirstBoardMilestone(firstBoardMilestoneByProject[project.id])
                const canShowProject = !!firstMilestone
                if (canShowProject && !firstMilestoneId) firstMilestoneId = firstMilestone.id
                if (canShowProject) amountOfProjectsWithMilestones++

                return (
                    <MilestonesListByProject
                        key={project.id}
                        projectId={project.id}
                        projectIndex={project.index}
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
            {amountOfProjectsWithMilestones === 0 && (
                <EmptyGoalsAllProjects sortedActiveProjects={sortedLoggedUserProjects} />
            )}
        </View>
    )
}
