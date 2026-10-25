import React, { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import {
    buildSecondaryViewCacheKey,
    getSecondaryViewCacheEntry,
    getSecondaryViewCacheEntrySync,
    SECONDARY_VIEW_GOALS,
    setSecondaryViewCacheEntry,
} from '../../utils/InitialLoad/secondaryViewCache'
import store from '../../redux/store'

const NO_MILESTONE_DATE = moment('5000-01-01').valueOf()
const EMPTY_IDS = []

export const getProjectsToWatch = (loggedUserProjects, templateProjectIds, archivedProjectIds) =>
    loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

export function GoalsProjectWatcher({ project, currentUserId, trackInitialLoad, onInitialSnapshot }) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const goals = useSelector(state => state.goalsByProject[project.id])
    const openMilestones = useSelector(state => state.openMilestonesByProject[project.id])
    const doneMilestones = useSelector(state => state.doneMilestonesByProject[project.id])
    const ownerId = getOwnerId(project.id, currentUserId)
    const cacheKey = buildSecondaryViewCacheKey(project.id, ownerId)
    const liveSnapshotDelivered = useRef(false)
    const cacheApplied = useRef(false)

    const applyCachedSnapshot = useCallback(
        cachedSnapshot => {
            if (
                !cachedSnapshot ||
                !Array.isArray(cachedSnapshot.goals) ||
                !Array.isArray(cachedSnapshot.openMilestones) ||
                !Array.isArray(cachedSnapshot.doneMilestones)
            ) {
                return false
            }
            dispatch([
                setGoalsInProject(project.id, cachedSnapshot.goals),
                setOpenMilestonesInProject(project.id, cachedSnapshot.openMilestones),
                setDoneMilestonesInProject(project.id, cachedSnapshot.doneMilestones),
            ])
            onInitialSnapshot(project.id)
            return true
        },
        [cacheKey, dispatch, onInitialSnapshot, project.id]
    )

    useLayoutEffect(() => {
        liveSnapshotDelivered.current = false
        cacheApplied.current = applyCachedSnapshot(
            getSecondaryViewCacheEntrySync(loggedUserId, SECONDARY_VIEW_GOALS, cacheKey)
        )
    }, [applyCachedSnapshot, cacheKey, loggedUserId])

    useEffect(() => {
        let active = true
        getSecondaryViewCacheEntry(loggedUserId, SECONDARY_VIEW_GOALS, cacheKey).then(cachedSnapshot => {
            if (active && !liveSnapshotDelivered.current) {
                cacheApplied.current = applyCachedSnapshot(cachedSnapshot)
            }
        })
        return () => {
            active = false
        }
    }, [applyCachedSnapshot, cacheKey, loggedUserId])

    useEffect(() => {
        if (!Array.isArray(goals) || !Array.isArray(openMilestones) || !Array.isArray(doneMilestones)) return
        setSecondaryViewCacheEntry(loggedUserId, SECONDARY_VIEW_GOALS, cacheKey, {
            projectId: project.id,
            ownerId,
            goals,
            openMilestones,
            doneMilestones,
        })
    }, [cacheKey, doneMilestones, goals, loggedUserId, openMilestones, ownerId, project.id])

    useEffect(() => {
        const goalsWatcherKey = v4()
        const milestonesWatcherKey = v4()
        const deliveredSnapshots = new Set()
        const markSnapshotDelivered = snapshotType => {
            // Once either listener has delivered, its Redux slice is newer than the projection.
            // Do not let a slower IndexedDB read put an older full projection over that slice.
            liveSnapshotDelivered.current = true
            deliveredSnapshots.add(snapshotType)
            if (deliveredSnapshots.size === 2) {
                onInitialSnapshot(project.id)
            }
        }
        const watcherOptions = {
            // A restored board is already usable. Keep the listener refresh entirely in the
            // background instead of showing the page spinner over those cached rows.
            manageLoading: trackInitialLoad && !cacheApplied.current,
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
            const state = store.getState()
            const currentGoals = state.goalsByProject[project.id]
            const currentOpenMilestones = state.openMilestonesByProject[project.id]
            const currentDoneMilestones = state.doneMilestonesByProject[project.id]
            if (
                Array.isArray(currentGoals) &&
                Array.isArray(currentOpenMilestones) &&
                Array.isArray(currentDoneMilestones)
            ) {
                setSecondaryViewCacheEntry(loggedUserId, SECONDARY_VIEW_GOALS, cacheKey, {
                    projectId: project.id,
                    ownerId,
                    goals: currentGoals,
                    openMilestones: currentOpenMilestones,
                    doneMilestones: currentDoneMilestones,
                })
            }
            Backend.unwatch(milestonesWatcherKey)
            Backend.unwatch(goalsWatcherKey)
            dispatch([
                setOpenMilestonesInProject(project.id, null),
                setDoneMilestonesInProject(project.id, null),
                setGoalsInProject(project.id, null),
            ])
        }
    }, [cacheKey, currentUserId, loggedUserId, onInitialSnapshot, ownerId, project.id, trackInitialLoad])

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
