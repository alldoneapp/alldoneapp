import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'

import { setAllFeeds, setFollowedFeeds, setInPartnerFeeds } from '../../redux/actions'
import ProjectLabelFeed from './Commons/ProjectLabelFeed'
import FeedsGlobalList from './FeedsGlobalList'
import Backend from '../../utils/BackendBridge'
import { HISTORICAL_MODE, LOADING_MODE } from './Utils/FeedsHelper'

export default function GlobalProject({
    project,
    feedActiveTab,
    updateProjectNewFeedAmount,
    amountNewFeeds,
    feedsData,
    followedFeedsData,
    globalActiveMode,
    feedsUserId,
    projectId,
}) {
    const dispatch = useDispatch()
    const feedViewData = { type: 'globalProject' }

    const showNewDayNotification = useSelector(state => state.showNewDayNotification)
    const allFeeds = useSelector(state => state.allFeeds[projectId])
    const followedFeeds = useSelector(state => state.followedFeeds[projectId])

    const [switchingBetweenUsers, setSwitchingBetweenUsers] = useState(null)
    const [loaded, setLoaded] = useState(false)
    const [currentDate, setCurrentDate] = useState(moment())
    const currentDateFormated = currentDate.format('DDMMYYYY')
    const [activeUser, setActiveUser] = useState(feedsUserId)
    const [activeProjectId, setActiveProjectId] = useState(projectId)

    const reloadStoreFeeds = userId => {
        dispatch([setFollowedFeeds(), setAllFeeds()])
        Backend.unsubStoreFeedsTab(projectId)
        Backend.watchNewFeedsAllTabsRedux(projectId, userId)
    }

    useEffect(() => {
        if (allFeeds && followedFeeds && switchingBetweenUsers) {
            setSwitchingBetweenUsers(false)
        }
    }, [allFeeds, followedFeeds])

    useEffect(() => {
        if (switchingBetweenUsers === null) {
            setSwitchingBetweenUsers(false)
        } else {
            setSwitchingBetweenUsers(true)
            if (projectId !== activeProjectId || feedsUserId !== activeUser) {
                updateProjectNewFeedAmount(activeProjectId, 0)
            }

            setActiveUser(feedsUserId)
            setActiveProjectId(projectId)
            reloadStoreFeeds(feedsUserId)
        }
    }, [feedsUserId, projectId])

    useEffect(() => {
        reloadStoreFeeds(feedsUserId)
    }, [])

    useEffect(() => {
        setLoaded(false)
    }, [feedActiveTab])

    useEffect(() => {
        setCurrentDate(moment())
    }, [showNewDayNotification])

    const cleanFeedsWatchers = () => {
        dispatch([setFollowedFeeds(), setAllFeeds(), setInPartnerFeeds(false)])
        Backend.unsubStoreFeedsTab(projectId)
    }

    useEffect(() => {
        return cleanFeedsWatchers
    }, [])

    if (
        (globalActiveMode === HISTORICAL_MODE || (feedsData[projectId] && feedsData[projectId].length > 0)) &&
        !loaded
    ) {
        setLoaded(true)
    }

    if (globalActiveMode === LOADING_MODE || !loaded) {
        if (amountNewFeeds !== 0) {
            updateProjectNewFeedAmount(projectId, 0)
        }
        return <View />
    }

    return (
        <View>
            <ProjectLabelFeed project={project} amountNewFeeds={amountNewFeeds} feedActiveTab={feedActiveTab} />
            {!switchingBetweenUsers && feedsUserId === activeUser && activeProjectId === projectId && (
                <View>
                    <FeedsGlobalList
                        projectId={projectId}
                        currentDateFormated={currentDateFormated}
                        feedViewData={feedViewData}
                        feedActiveTab={feedActiveTab}
                        updateProjectNewFeedAmount={updateProjectNewFeedAmount}
                        counterNewFeedsData={feedsData[projectId]}
                        followedFeedsData={followedFeedsData[projectId]}
                        allFeeds={allFeeds}
                        followedFeeds={followedFeeds}
                    />
                </View>
            )}
        </View>
    )
}
