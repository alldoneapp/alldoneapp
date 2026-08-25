import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'
import moment from 'moment'

import MilestonesListByProject from './MilestonesListByProject'
import { getOwnerId, GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import { setDoneMilestonesInProject, setGoalsInProject, setOpenMilestonesInProject } from '../../redux/actions'
import URLsGoals, { URL_ALL_PROJECTS_GOALS_DONE, URL_ALL_PROJECTS_GOALS_OPEN } from '../../URLSystem/Goals/URLsGoals'

import EmptyGoalsAllProjects from './EmptyGoalsAllProjects'
import Backend from '../../utils/BackendBridge'
import { watchAllGoals, watchAllMilestones } from '../../utils/backends/Goals/goalsFirestore'
import { decodeFirstBoardMilestone, selectFirstBoardMilestoneByProject } from './goalsBoardSelectors'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'

const NO_MILESTONE_DATE = moment('5000-01-01').valueOf()
const EMPTY_IDS = []

export const getProjectsToWatch = (loggedUserProjects, templateProjectIds, archivedProjectIds) =>
    loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

export function GoalsProjectWatcher({ project, currentUserId, trackInitialLoad, onInitialSnapshot }) {
    const dispatch = useDispatch()

    useEffect(() => {
        const goalsWatcherKey = v4()
        const milestonesWatcherKey = v4()
        const ownerId = getOwnerId(project.id, currentUserId)
        const deliveredSnapshots = new Set()
        const markSnapshotDelivered = snapshotType => {
            deliveredSnapshots.add(snapshotType)
            if (deliveredSnapshots.size === 2) onInitialSnapshot(project.id)
        }
        const watcherOptions = {
            manageLoading: trackInitialLoad,
            trackConnectionHealth: trackInitialLoad,
        }

        watchAllMilestones(project.id, milestonesWatcherKey, ownerId, {
            ...watcherOptions,
            onInitialSnapshot: () => markSnapshotDelivered('milestones'),
        })
        watchAllGoals(project.id, goalsWatcherKey, ownerId, {
            ...watcherOptions,
            onInitialSnapshot: () => markSnapshotDelivered('goals'),
        })

        return () => {
            Backend.unwatch(milestonesWatcherKey)
            Backend.unwatch(goalsWatcherKey)
            dispatch([
                setOpenMilestonesInProject(project.id, null),
                setDoneMilestonesInProject(project.id, null),
                setGoalsInProject(project.id, null),
            ])
        }
    }, [currentUserId, project.id, trackInitialLoad])

    return null
}

export default function GoalsViewAllProjects({ openEdition, closeEdition, unsetDismissibleRefs, setDismissibleRefs }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const processedInitialURL = useSelector(state => state.processedInitialURL)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds || EMPTY_IDS)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds || EMPTY_IDS)
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
    const sortedProjectIds = useMemo(
        () => sortedLoggedUserProjects.map(project => project.id),
        [sortedLoggedUserProjects]
    )
    const projectMembershipKey = useMemo(() => [...sortedProjectIds].sort().join('\u001f'), [sortedProjectIds])
    const projectRevealKey = `${currentUserId}:${projectMembershipKey}`
    const projectRevealKeyRef = useRef(projectRevealKey)
    projectRevealKeyRef.current = projectRevealKey
    const [projectReadiness, setProjectReadiness] = useState({ key: projectRevealKey, projectIds: [] })
    const readyProjectIds = projectReadiness.key === projectRevealKey ? projectReadiness.projectIds : []
    const markProjectReady = useCallback(projectId => {
        setProjectReadiness(current => {
            const key = projectRevealKeyRef.current
            const projectIds = current.key === key ? current.projectIds : []
            if (projectIds.includes(projectId)) return current
            return { key, projectIds: [...projectIds, projectId] }
        })
    }, [])
    const { revealedProjectIds, primaryProjectId, complete } = useRateLimitedProjectReveal({
        projectIds: sortedProjectIds,
        readyProjectIds,
        resetKey: projectRevealKey,
    })
    const revealedProjectIdsSet = useMemo(() => new Set(revealedProjectIds), [revealedProjectIds])
    const visibleProjects = sortedLoggedUserProjects.filter(project => revealedProjectIdsSet.has(project.id))

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
            {visibleProjects.map(project => {
                const firstMilestone = decodeFirstBoardMilestone(firstBoardMilestoneByProject[project.id])
                const canShowProject = !!firstMilestone
                if (canShowProject && !firstMilestoneId) firstMilestoneId = firstMilestone.id
                if (canShowProject) amountOfProjectsWithMilestones++

                return (
                    <Fragment key={project.id}>
                        <GoalsProjectWatcher
                            project={project}
                            currentUserId={currentUserId}
                            trackInitialLoad={project.id === primaryProjectId}
                            onInitialSnapshot={markProjectReady}
                        />
                        <MilestonesListByProject
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
                    </Fragment>
                )
            })}
            {complete && amountOfProjectsWithMilestones === 0 && (
                <EmptyGoalsAllProjects sortedActiveProjects={sortedLoggedUserProjects} />
            )}
        </View>
    )
}
