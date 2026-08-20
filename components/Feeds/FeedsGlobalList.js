import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import moment from 'moment'
import { useSelector } from 'react-redux'

import FeedsList from './FeedsList'
import ShowMoreButton from './Commons/ShowMoreButton'
import { ALL_TAB, FOLLOWED_TAB } from './Utils/FeedsConstants'
import { UNFOLLOWED_TYPES } from './Utils/HelperFunctions'
import {
    getInitialData,
    getLimitFeedAmountToDisplay,
    HISTORICAL_MODE,
    LOADING_MODE,
    MAX_FEEDS_AMOUNT_TO_DISPLAY,
    mergeFeedsInFeedsByDate,
    mergeLocalFeedInFeedsByDate,
    NEW_FEEDS_MODE,
    processInitialFeeds,
    removedCommentFeedFromFeedsByDate,
    removeFeedFromFeedsByDate,
    removeFeedObjectFromFeedsByDate,
    updateFeedsState,
} from './Utils/FeedsHelper'
import useLoadingMore from '../../hooks/useLoadingMore'
import FeedsListSkeleton from './FeedsListSkeleton'
import { resolveGhostRowCount } from '../UIComponents/Ghosts/ghostRowCount'

export default function FeedsGlobalList({
    projectId,
    currentDateFormated,
    feedViewData,
    feedActiveTab,
    updateProjectNewFeedAmount,
    counterNewFeedsData,
    followedFeedsData,
    allFeeds,
    followedFeeds,
    onRequestAllFeeds,
}) {
    const newLocalFeedData = useSelector(state => state.newLocalFeedData)

    const [showShowLessButton, setShowShowLessButton] = useState(false)
    const [showShowMoreButton, setShowShowMoreButton] = useState(false)
    const [internalFeedActiveTab, setInternalFeedActiveTab] = useState(feedActiveTab)
    const [followedFeedsDataAmount, setFollowedFeedsDataAmount] = useState(0)
    const [newFeedsIds, setNewFeedsIds] = useState([])
    const [maxAmountOfFeedToDisplay, setMaxAmountOfFeedToDisplay] = useState(0)
    const [displayedFeedsOrdered, setDisplayedFeedsOrdered] = useState([])
    const [feedsByDate, setFeedsByDate] = useState({})
    const [feedsOrderedArray, setFeedsOrderedArray] = useState([])
    const [activeMode, setActiveMode] = useState(LOADING_MODE)
    const [expandRequested, setExpandRequested] = useState(false)

    // AT-2382 - the widened listener replaces this array on delivery, so its identity is
    // the "the extra feeds arrived" edge that retires the ghosts. Deliberately NOT keyed on
    // `expandRequested`: the top-up effect calls `expandFeedList` again, which re-arms that
    // flag, so it stays true until the list is contracted and would ghost forever.
    const feedsForActiveTab = feedActiveTab === FOLLOWED_TAB ? followedFeeds : allFeeds
    const [loadingMoreFeeds, startLoadingMoreFeeds] = useLoadingMore(feedsForActiveTab)

    // The button's handler, as opposed to the top-up effect's. Only a real press arms the
    // ghosts; the effect re-enters `expandFeedList` and must not restart them.
    const onPressShowMore = () => {
        startLoadingMoreFeeds()
        expandFeedList()
    }

    const contractFeedList = () => {
        setMaxAmountOfFeedToDisplay(getLimitFeedAmountToDisplay())
        setShowShowLessButton(false)
        // Stop topping the list back up, otherwise the next snapshot would re-expand it on its own.
        setExpandRequested(false)

        const lastFeeds = displayedFeedsOrdered.slice(getLimitFeedAmountToDisplay())
        lastFeeds.forEach(feed => {
            removeFeedFromFeedsByDate(feedsByDate, feed)
        })

        const newFeedsForDisplay = displayedFeedsOrdered.slice(0, getLimitFeedAmountToDisplay())
        updateFeedsState(
            feedsByDate,
            newFeedsForDisplay,
            setFeedsByDate,
            setDisplayedFeedsOrdered,
            setFeedsOrderedArray,
            feedActiveTab
        )
    }

    const expandFeedList = () => {
        if (activeMode === NEW_FEEDS_MODE) {
            setActiveMode(HISTORICAL_MODE)
        }
        setMaxAmountOfFeedToDisplay(MAX_FEEDS_AMOUNT_TO_DISPLAY)
        setShowShowMoreButton(false)
        // The listener is capped at what this list displays, so the feeds beyond the first page have
        // to be requested before they can be rendered. Whatever is already loaded is processed right
        // away; the effect below tops the list up when the wider snapshot arrives.
        setExpandRequested(true)
        if (onRequestAllFeeds) onRequestAllFeeds()

        const feedsToProcess = feedActiveTab === FOLLOWED_TAB ? followedFeeds : allFeeds

        feedsToProcess.forEach(feed => {
            const { id } = feed
            feed.showLikeNew = newFeedsIds.includes(id)
        })

        processInitialFeeds(
            HISTORICAL_MODE,
            projectId,
            feedActiveTab,
            feedsToProcess,
            setFeedsByDate,
            setFeedsOrderedArray,
            setDisplayedFeedsOrdered,
            newFeedsIds,
            setNewFeedsIds
        )
    }

    const processInitialFeedsInTab = () => {
        const { mode, feedsToProcess } = getInitialData(feedActiveTab, counterNewFeedsData, followedFeeds, allFeeds)
        setActiveMode(mode)
        setMaxAmountOfFeedToDisplay(
            mode === NEW_FEEDS_MODE ? MAX_FEEDS_AMOUNT_TO_DISPLAY : getLimitFeedAmountToDisplay()
        )

        processInitialFeeds(
            mode,
            projectId,
            feedActiveTab,
            feedsToProcess,
            setFeedsByDate,
            setFeedsOrderedArray,
            setDisplayedFeedsOrdered,
            [],
            setNewFeedsIds
        )
    }

    const changeTab = () => {
        const feedsToProcess = feedActiveTab === FOLLOWED_TAB ? followedFeeds : allFeeds

        feedsToProcess.forEach(feed => {
            feed.showLikeNew = false
        })

        setFollowedFeedsDataAmount(0)
        setShowShowMoreButton(false)
        setShowShowLessButton(false)
        setFeedsOrderedArray([])
        setNewFeedsIds([])
        setExpandRequested(false)
        setInternalFeedActiveTab(feedActiveTab)

        processInitialFeedsInTab()
    }

    const getNewFeedObjectsAmount = () => {
        const objectKeys = new Set()

        counterNewFeedsData?.forEach(feed => {
            if (newFeedsIds.includes(feed.id)) {
                objectKeys.add(`${feed.objectTypes || feed.type}/${feed.objectId}`)
            }
        })

        return objectKeys.size
    }

    useEffect(() => {
        if (activeMode !== LOADING_MODE) {
            if (activeMode === NEW_FEEDS_MODE) {
                setShowShowMoreButton(true)
            } else {
                setShowShowMoreButton(displayedFeedsOrdered.length === getLimitFeedAmountToDisplay())
                setShowShowLessButton(displayedFeedsOrdered.length > getLimitFeedAmountToDisplay())
            }
        }
    }, [displayedFeedsOrdered])

    useEffect(() => {
        updateProjectNewFeedAmount(projectId, getNewFeedObjectsAmount())
    }, [newFeedsIds, counterNewFeedsData])

    useEffect(() => {
        if (activeMode !== LOADING_MODE) {
            changeTab()
        }
    }, [feedActiveTab])

    useEffect(() => {
        if (followedFeedsData) {
            setFollowedFeedsDataAmount(followedFeedsData.length)
            if (activeMode === HISTORICAL_MODE && feedActiveTab === ALL_TAB) {
                const amountOfFeedsForAdd = followedFeedsData.length - followedFeedsDataAmount
                const amountOfTotalFeeds = displayedFeedsOrdered.length + amountOfFeedsForAdd
                mergeFeedsInFeedsByDate(
                    projectId,
                    feedsByDate,
                    displayedFeedsOrdered,
                    maxAmountOfFeedToDisplay,
                    setFeedsByDate,
                    setDisplayedFeedsOrdered,
                    setFeedsOrderedArray,
                    amountOfFeedsForAdd,
                    amountOfTotalFeeds,
                    followedFeedsData.slice(0, amountOfFeedsForAdd),
                    false,
                    feedActiveTab
                )
            }
        }
    }, [followedFeedsData])

    useEffect(() => {
        if (activeMode !== LOADING_MODE && newLocalFeedData && newLocalFeedData.projectId === projectId) {
            const { feed, object, params } = newLocalFeedData
            const { type } = feed
            if (UNFOLLOWED_TYPES.includes(type) && feedActiveTab === FOLLOWED_TAB) {
                removeFeedObjectFromFeedsByDate(feedsByDate, object)

                const newFeedsForDisplay = displayedFeedsOrdered.filter(
                    displayedFeed => object.id !== displayedFeed.objectId
                )

                updateFeedsState(
                    feedsByDate,
                    newFeedsForDisplay,
                    setFeedsByDate,
                    setDisplayedFeedsOrdered,
                    setFeedsOrderedArray,
                    feedActiveTab
                )
            } else {
                if (params && params.editModeData) {
                    const { editModeData } = params
                    const { feedId, formatedDate } = editModeData
                    removedCommentFeedFromFeedsByDate(feedsByDate, formatedDate, object.id, feedId)
                }

                mergeLocalFeedInFeedsByDate(feedsByDate, feed, object)

                const amountOfTotalFeeds = displayedFeedsOrdered.length + 1

                let newFeedsForDisplay
                if (amountOfTotalFeeds > maxAmountOfFeedToDisplay) {
                    const lastFeed = displayedFeedsOrdered[maxAmountOfFeedToDisplay - 1]
                    removeFeedFromFeedsByDate(feedsByDate, lastFeed)
                    newFeedsForDisplay = [feed, ...displayedFeedsOrdered.slice(0, maxAmountOfFeedToDisplay - 1)]
                } else {
                    newFeedsForDisplay = [feed, ...displayedFeedsOrdered]
                }

                updateFeedsState(
                    feedsByDate,
                    newFeedsForDisplay,
                    setFeedsByDate,
                    setDisplayedFeedsOrdered,
                    setFeedsOrderedArray,
                    feedActiveTab
                )
            }
        }
    }, [newLocalFeedData])

    useEffect(() => {
        if (
            activeMode !== LOADING_MODE &&
            feedActiveTab === internalFeedActiveTab &&
            counterNewFeedsData &&
            counterNewFeedsData.length > 0
        ) {
            const feedsIds = counterNewFeedsData.map(feed => feed.id)
            const counterNewFeedsIds = feedsIds.filter(id => !newFeedsIds.includes(id))
            setNewFeedsIds([...newFeedsIds, ...counterNewFeedsIds])
        }
    }, [counterNewFeedsData])

    useEffect(() => {
        if (allFeeds && followedFeeds && counterNewFeedsData && activeMode === LOADING_MODE) {
            processInitialFeedsInTab()
        }
    }, [allFeeds, followedFeeds, counterNewFeedsData])

    // Top the expanded list up once the widened listener delivers the feeds that were beyond the
    // first page. Only runs after "show more" was pressed, and only while the incoming snapshot
    // holds more feeds than are already on screen, so it cannot loop.
    useEffect(() => {
        if (!expandRequested || activeMode === LOADING_MODE) return
        const feedsToProcess = feedActiveTab === FOLLOWED_TAB ? followedFeeds : allFeeds
        if (!feedsToProcess || feedsToProcess.length <= displayedFeedsOrdered.length) return
        expandFeedList()
    }, [allFeeds, followedFeeds])

    return (
        <View>
            {feedsOrderedArray.map(dateFeeds => {
                const { formatedDate, feedObjects } = dateFeeds
                return (
                    <FeedsList
                        key={formatedDate + projectId}
                        projectId={projectId}
                        feedObjects={feedObjects}
                        feedViewData={feedViewData}
                        feedActiveTab={feedActiveTab}
                        currentDateFormated={currentDateFormated}
                        forceRender={activeMode !== LOADING_MODE}
                        date={moment(formatedDate, 'DDMMYYYY')}
                    />
                )
            })}

            {loadingMoreFeeds && <FeedsListSkeleton rowCount={resolveGhostRowCount(MAX_FEEDS_AMOUNT_TO_DISPLAY)} />}

            <View style={localStyles.buttonsContainer}>
                {showShowMoreButton ? (
                    <ShowMoreButton forExpand={true} onPress={onPressShowMore} loading={loadingMoreFeeds} />
                ) : null}
                {showShowLessButton ? (
                    <ShowMoreButton style={localStyles.lessButton} forExpand={false} onPress={contractFeedList} />
                ) : null}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttonsContainer: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
    lessButton: {
        marginLeft: 8,
    },
})
