import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Backend from '../../utils/BackendBridge'
import ProjectHelper, { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'
import {
    setAllFeedsAmount,
    setFollowedFeedsAmount,
    setFollowedFeedsData,
    setAllFeedsData,
    setLoadedNewFeeds,
    updateGoogleMeetNotificationModalData,
} from '../../redux/actions'
import useReachEmptyInbox from '../../hooks/useReachEmptyInbox'
import {
    PROJECT_TYPE_ACTIVE,
    PROJECT_TYPE_GUIDE,
    PROJECT_TYPE_SHARED,
} from '../SettingsView/ProjectsSettings/ProjectsSettings'
import useSideBarTasksAmount from '../../hooks/Tasks/useSideBarTasksAmount'
import SharedProjectsUnmountLogic from './SharedProjectsUnmountLogic'
import ObservedForWatchOutsideNewProjectsChats from './ObservedForWatchOutsideNewProjectsChats'

export default function InitLoadView({}) {
    const dispatch = useDispatch()
    const followedFeedsData = useSelector(state => state.followedFeedsData)
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const projectsMeetings = useSelector(state => state.projectsMeetings)
    const [timeOfFeedsLoaded, setTimeOfFeedsLoaded] = useState(0)
    const [watchedProjectsIds, setWatchedProjectsIds] = useState([])
    useReachEmptyInbox()
    useSideBarTasksAmount()

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    let followedCounters = {}
    let allCounters = {}
    let followedData = {}
    let allData = {}
    let timeOfFeedsLoadedInternal = 0

    const { email } = loggedUser
    const [meetings, setMeetings] = useState([])
    const [counter, setCounter] = useState(0)

    useEffect(() => {
        Object.keys(projectsMeetings).map(function (key, index) {
            if (projectsMeetings[key].length > 0) {
                setMeetings(projectsMeetings[key])
            }
        })
    }, [Object.values(projectsMeetings)])

    useEffect(() => {
        meetings.length > 0 &&
            counter === 0 &&
            meetings.map(item => {
                setCounter(counter + 1)
                const guest = item.guests.find(f => f.email === email)
                if (guest && guest.attend === 0) {
                    dispatch(updateGoogleMeetNotificationModalData(true, item.projectId, email, item))
                }
                setCounter(0)
            })
    }, [meetings])

    //////////////////////// Feeds counting ////////////////////////

    const updateFollowedFeedsData = (projectId, newFeedsData) => {
        followedCounters = updateFeedsData(
            projectId,
            newFeedsData,
            followedCounters,
            setFollowedFeedsAmount,
            followedData,
            setFollowedFeedsData
        )
    }

    const updateAllFeedsData = (projectId, newFeedsData) => {
        allCounters = updateFeedsData(projectId, newFeedsData, allCounters, setAllFeedsAmount, allData, setAllFeedsData)
    }

    const updateFeedsData = (
        projectId,
        newFeedsData,
        projectsCounters,
        setAmountDispatch,
        currentFeedsData,
        setFeedsDataDispatch
    ) => {
        const { feedsAmount, feedsData } = newFeedsData

        currentFeedsData[projectId] = feedsData
        dispatch(setFeedsDataDispatch(currentFeedsData))

        if (inSelectedProject) {
            projectsCounters = {}
            dispatch(setAmountDispatch(feedsAmount))
        } else {
            projectsCounters[projectId] = feedsAmount
            let totalCount = 0
            const counters = Object.values(projectsCounters)
            for (let i = 0; i < counters.length; i++) {
                totalCount += counters[i]
            }
            dispatch(setAmountDispatch(totalCount))
        }
        timeOfFeedsLoadedInternal++
        setTimeOfFeedsLoaded(timeOfFeedsLoadedInternal)
        return projectsCounters
    }

    //////////////////////// Feeds counting ////////////////////////

    useEffect(() => {
        if (watchedProjectsIds.length > 0 && Object.keys(followedFeedsData).length === watchedProjectsIds.length) {
            dispatch(setLoadedNewFeeds())
        }
    }, [timeOfFeedsLoaded])

    const cleanComponent = () => {
        for (let i = 0; i < watchedProjectsIds.length; i++) {
            Backend.unsubNewFeedsTab(watchedProjectsIds[i], 'followed')
            Backend.unsubNewFeedsTab(watchedProjectsIds[i], 'all')
        }
    }

    const watchAllProjects = () => {
        cleanComponent()
        const filteredProjects = ProjectHelper.getProjectsByType(loggedUserProjects, loggedUser, PROJECT_TYPE_ACTIVE)
        const guideProjects = ProjectHelper.getProjectsByType(loggedUserProjects, loggedUser, PROJECT_TYPE_GUIDE)
        filteredProjects.push(...guideProjects)
        Backend.watchAllNewFeedsAllTabs(filteredProjects, loggedUser.uid, updateFollowedFeedsData, updateAllFeedsData)
        const newWatchedProjectsIds = []
        for (let i = 0; i < filteredProjects.length; i++) {
            newWatchedProjectsIds.push(filteredProjects[i].id)
        }
        setWatchedProjectsIds(newWatchedProjectsIds)
    }

    const watchProject = () => {
        cleanComponent()
        if (loggedUserProjects[selectedProjectIndex]) {
            const projectId = loggedUserProjects[selectedProjectIndex].id
            Backend.watchNewFeedsAllTabs(projectId, loggedUser.uid, updateFollowedFeedsData, updateAllFeedsData)
            setWatchedProjectsIds([projectId])
        }
    }

    useEffect(() => {
        inSelectedProject ? watchProject() : watchAllProjects()
        return cleanComponent
    }, [loggedUserProjects, selectedProjectIndex])

    return (
        <View>
            {selectedTypeOfProject === PROJECT_TYPE_SHARED && <SharedProjectsUnmountLogic />}
            <ObservedForWatchOutsideNewProjectsChats />
        </View>
    )
}
