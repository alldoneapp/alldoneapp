import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'

import { setAllFeeds, setFollowedFeeds, setInPartnerFeeds } from '../../redux/actions'
import ProjectLabelFeed from './Commons/ProjectLabelFeed'
import FeedsGlobalList from './FeedsGlobalList'
import Backend from '../../utils/BackendBridge'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { FOLLOWED_TAB } from './Utils/FeedsConstants'
import {
    ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY,
    HISTORICAL_MODE,
    LOADING_MODE,
    MAX_FEEDS_AMOUNT_TO_DISPLAY,
    STANDARD_FEEDS_AMOUNT_TO_DISPLAY,
} from './Utils/FeedsHelper'

// Hoisted out of the component: it is threaded down to every feed card, so a new object literal per
// render would defeat memoization all the way down the tree.
const FEED_VIEW_DATA = { type: 'globalProject' }

function GlobalProject({
    project,
    feedActiveTab,
    updateProjectNewFeedAmount,
    amountNewFeeds,
    globalActiveMode,
    feedsUserId,
    projectId,
    trackInitialLoad = true,
    onInitialSnapshot,
}) {
    const dispatch = useDispatch()

    const showNewDayNotification = useSelector(state => state.showNewDayNotification)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const allFeeds = useSelector(state => state.allFeeds[projectId])
    const followedFeeds = useSelector(state => state.followedFeeds[projectId])
    const activeTabFeeds = feedActiveTab === FOLLOWED_TAB ? followedFeeds : allFeeds
    // Read straight from the store rather than through props. `followedFeedsData` / `allFeedsData`
    // are written by mutating the map in place (InitLoadView), so the map's identity never changes
    // and a parent re-render was the only thing that ever delivered a fresh counter. Selecting the
    // per-project slice here re-renders exactly the project whose counter moved - and makes the
    // memoization below safe.
    const counterNewFeedsData = useSelector(
        state => (feedActiveTab === FOLLOWED_TAB ? state.followedFeedsData : state.allFeedsData)[projectId]
    )
    const followedCounterFeedsData = useSelector(state => state.followedFeedsData[projectId])

    const [switchingBetweenUsers, setSwitchingBetweenUsers] = useState(null)
    const [loaded, setLoaded] = useState(false)
    const [currentDate, setCurrentDate] = useState(moment())
    const currentDateFormated = currentDate.format('DDMMYYYY')
    const [activeUser, setActiveUser] = useState(feedsUserId)
    const [activeProjectId, setActiveProjectId] = useState(projectId)

    // How many feeds this project's list can display right now. The listeners are capped at this
    // instead of always pulling 200 documents per project per tab (AT-2192). `feedsExpanded` is
    // raised by "show more" in FeedsGlobalList and never lowered again, so collapsing the list does
    // not cost another round trip.
    const [feedsExpanded, setFeedsExpanded] = useState(false)
    const baseFeedsAmount = checkIfSelectedAllProjects(selectedProjectIndex)
        ? ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY
        : STANDARD_FEEDS_AMOUNT_TO_DISPLAY
    const feedsLimit = feedsExpanded ? MAX_FEEDS_AMOUNT_TO_DISPLAY : baseFeedsAmount
    const watchedFeedsLimit = useRef(feedsLimit)

    const reloadStoreFeeds = (userId, trackLoad = trackInitialLoad) => {
        // Scoped to this project: `setFollowedFeeds()` / `setAllFeeds()` without a project id reset
        // the whole map, so with one GlobalProject mounted per project every mount used to throw
        // away every other project's already-loaded feeds.
        dispatch([setFollowedFeeds(projectId, undefined), setAllFeeds(projectId, undefined)])
        watchedFeedsLimit.current = feedsLimit
        Backend.unsubStoreFeedsTab(projectId)
        Backend.watchNewFeedsAllTabsRedux(projectId, userId, feedsLimit, {
            manageLoading: trackLoad,
            trackConnectionHealth: trackLoad,
            onInitialSnapshot,
        })
    }

    const requestAllFeeds = useCallback(() => {
        setFeedsExpanded(true)
    }, [])

    useEffect(() => {
        if (activeTabFeeds && switchingBetweenUsers) {
            setSwitchingBetweenUsers(false)
        }
    }, [activeTabFeeds, switchingBetweenUsers])

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

    // Widen the subscription in place when the list needs more feeds than it asked for at mount.
    // The feeds already in the store are deliberately left alone so "show more" keeps rendering the
    // current rows until the larger snapshot arrives.
    useEffect(() => {
        if (watchedFeedsLimit.current === feedsLimit) return
        watchedFeedsLimit.current = feedsLimit
        Backend.unsubStoreFeedsTab(projectId)
        Backend.watchNewFeedsAllTabsRedux(projectId, feedsUserId, feedsLimit, {
            manageLoading: true,
            trackConnectionHealth: true,
            onInitialSnapshot,
        })
    }, [feedsLimit])

    useEffect(() => {
        setLoaded(false)
    }, [feedActiveTab])

    useEffect(() => {
        setCurrentDate(moment())
    }, [showNewDayNotification])

    const cleanFeedsWatchers = () => {
        dispatch([setFollowedFeeds(projectId, undefined), setAllFeeds(projectId, undefined), setInPartnerFeeds(false)])
        Backend.unsubStoreFeedsTab(projectId)
    }

    useEffect(() => {
        return cleanFeedsWatchers
    }, [])

    if ((globalActiveMode === HISTORICAL_MODE || (counterNewFeedsData && counterNewFeedsData.length > 0)) && !loaded) {
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
                        feedViewData={FEED_VIEW_DATA}
                        feedActiveTab={feedActiveTab}
                        updateProjectNewFeedAmount={updateProjectNewFeedAmount}
                        counterNewFeedsData={counterNewFeedsData}
                        followedFeedsData={followedCounterFeedsData}
                        allFeeds={allFeeds}
                        followedFeeds={followedFeeds}
                        onRequestAllFeeds={requestAllFeeds}
                    />
                </View>
            )}
        </View>
    )
}

// The Updates page mounts one GlobalProject per project (140 for a large dogfooding account).
// Without memoization every re-render of RootViewFeedsGlobalProject - and `loggedUser`,
// `loggedUserProjects` and the new-feed counters all cause those constantly - re-rendered all of
// those feed subtrees. Every remaining prop is referentially stable: `project` keeps its identity
// through the parent's sort, `updateProjectNewFeedAmount` is a useCallback, and everything else is
// a primitive. The feeds data is no longer passed down at all; it is selected from the store above,
// so a counter update still reaches the one project it belongs to.
export default React.memo(GlobalProject)
