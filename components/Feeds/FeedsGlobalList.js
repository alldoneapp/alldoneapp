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

    const contractFeedList = () => {
        setMaxAmountOfFeedToDisplay(getLimitFeedAmountToDisplay())
        setShowShowLessButton(false)

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
        setInternalFeedActiveTab(feedActiveTab)

        processInitialFeedsInTab()
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
        updateProjectNewFeedAmount(projectId, newFeedsIds.length)
    }, [newFeedsIds])

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

            <View style={localStyles.buttonsContainer}>
                {showShowMoreButton ? <ShowMoreButton forExpand={true} onPress={expandFeedList} /> : null}
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
