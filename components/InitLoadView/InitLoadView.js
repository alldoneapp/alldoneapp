import React, { useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Backend from '../../utils/BackendBridge'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import {
    setAllFeedsAmount,
    setFollowedFeedsAmount,
    setFollowedFeedsData,
    setAllFeedsData,
    setLoadedNewFeeds,
} from '../../redux/actions'
import useReachEmptyInbox from '../../hooks/useReachEmptyInbox'
import useReachProjectEmptyInbox from '../../hooks/useReachProjectEmptyInbox'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import useSideBarTasksAmount from '../../hooks/Tasks/useSideBarTasksAmount'
import SharedProjectsUnmountLogic from './SharedProjectsUnmountLogic'
import ObservedForWatchOutsideNewProjectsChats from './ObservedForWatchOutsideNewProjectsChats'
import useDeferredStartupWork from '../../hooks/useDeferredStartupWork'

function InitLoadWatchers() {
    const dispatch = useDispatch()
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    useReachEmptyInbox()
    // AT-2492: the per-project sibling. Records "this project's today list was cleared" wherever the
    // user happens to be when it happens; the selected-project board decides what to do with it.
    useReachProjectEmptyInbox()
    useSideBarTasksAmount()

    const feedProjects = ProjectHelper.getGlobalFeedProjects(loggedUserProjects, loggedUser)
    // A project snapshot or navigation change must not restart the global badge subscriptions.
    const watchedFeedsKey = feedProjects
        .map(project => project.id)
        .sort()
        .join(',')

    useEffect(() => {
        let active = true
        const projectIds = feedProjects.map(project => project.id)
        const allowedProjectIds = new Set(projectIds)
        const followedCounters = {}
        const allCounters = {}
        let followedData = {}
        let allData = {}

        const clearFeedData = () => {
            dispatch([setFollowedFeedsAmount(0), setAllFeedsAmount(0), setFollowedFeedsData({}), setAllFeedsData({})])
        }
        clearFeedData()

        const updateFeedsData = (projectId, newFeedsData, followed) => {
            // Ignore deliveries from a retired user/membership generation, including queued snapshots.
            if (!active || !allowedProjectIds.has(projectId)) return
            const { feedsAmount, feedsData } = newFeedsData
            const counters = followed ? followedCounters : allCounters
            counters[projectId] = feedsAmount
            const amount = Object.values(counters).reduce((total, count) => total + count, 0)
            if (followed) {
                followedData = { ...followedData, [projectId]: feedsData }
                dispatch([setFollowedFeedsData(followedData), setFollowedFeedsAmount(amount)])
            } else {
                allData = { ...allData, [projectId]: feedsData }
                dispatch([setAllFeedsData(allData), setAllFeedsAmount(amount)])
            }
            if (
                Object.keys(followedCounters).length === projectIds.length &&
                Object.keys(allCounters).length === projectIds.length
            )
                dispatch(setLoadedNewFeeds())
        }

        Backend.watchAllNewFeedsAllTabs(
            feedProjects,
            loggedUser.uid,
            (projectId, data) => updateFeedsData(projectId, data, true),
            (projectId, data) => updateFeedsData(projectId, data, false)
        )
        if (projectIds.length === 0) dispatch(setLoadedNewFeeds())

        return () => {
            active = false
            projectIds.forEach(projectId => {
                Backend.unsubNewFeedsTab(projectId, 'followed')
                Backend.unsubNewFeedsTab(projectId, 'all')
            })
            clearFeedData()
        }
    }, [watchedFeedsKey, loggedUser.uid])

    return (
        <View>
            {selectedTypeOfProject === PROJECT_TYPE_SHARED && <SharedProjectsUnmountLogic />}
            <ObservedForWatchOutsideNewProjectsChats />
        </View>
    )
}

export default function InitLoadView() {
    const deferredStartupWorkReady = useDeferredStartupWork()
    return deferredStartupWorkReady ? <InitLoadWatchers /> : null
}
