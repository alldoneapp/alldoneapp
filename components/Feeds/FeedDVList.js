import React, { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import FeedsList from './FeedsList'
import ShowMoreButton from './Commons/ShowMoreButton'
import {
    STANDARD_FEEDS_AMOUNT_TO_DISPLAY,
    MAX_FEEDS_AMOUNT_TO_DISPLAY,
    LOADING_MODE,
    HISTORICAL_MODE,
    FILTERING_MODE,
    processInitialFeeds,
    mergeLocalFeedInFeedsByDate,
    removeFeedFromFeedsByDate,
    removedCommentFeedFromFeedsByDate,
    updateFeedsState,
} from './Utils/FeedsHelper'
import { FOLLOWED_TAB } from './Utils/FeedsConstants'

export default function FeedDVList({ projectId, innerFeeds, feedViewData, objectId }) {
    const newLocalFeedData = useSelector(state => state.newLocalFeedData)

    const [showShowLessButton, setShowShowLessButton] = useState(false)
    const [showShowMoreButton, setShowShowMoreButton] = useState(false)
    const [maxAmountOfFeedToDisplay, setMaxAmountOfFeedToDisplay] = useState(STANDARD_FEEDS_AMOUNT_TO_DISPLAY)
    const [displayedFeedsOrdered, setDisplayedFeedsOrdered] = useState([])
    const [feedsByDate, setFeedsByDate] = useState({})
    const [feedsOrderedArray, setFeedsOrderedArray] = useState([])
    const [activeMode, setActiveMode] = useState(LOADING_MODE)

    const contractFeedList = () => {
        setMaxAmountOfFeedToDisplay(STANDARD_FEEDS_AMOUNT_TO_DISPLAY)
        setShowShowLessButton(false)

        const lastFeeds = displayedFeedsOrdered.slice(STANDARD_FEEDS_AMOUNT_TO_DISPLAY)
        lastFeeds.forEach(feed => {
            removeFeedFromFeedsByDate(feedsByDate, feed)
        })

        const newFeedsForDisplay = displayedFeedsOrdered.slice(0, STANDARD_FEEDS_AMOUNT_TO_DISPLAY)
        updateFeedsState(
            feedsByDate,
            newFeedsForDisplay,
            setFeedsByDate,
            setDisplayedFeedsOrdered,
            setFeedsOrderedArray,
            null
        )
    }

    const expandFeedList = () => {
        setMaxAmountOfFeedToDisplay(MAX_FEEDS_AMOUNT_TO_DISPLAY)
        setShowShowMoreButton(false)
        processFeeds(MAX_FEEDS_AMOUNT_TO_DISPLAY)
    }

    const processFeeds = amountOfFeedToDisplay => {
        const feedsToProcess = innerFeeds.slice(0, amountOfFeedToDisplay)
        processInitialFeeds(
            HISTORICAL_MODE,
            projectId,
            null,
            feedsToProcess,
            setFeedsByDate,
            setFeedsOrderedArray,
            setDisplayedFeedsOrdered,
            null,
            null
        )
    }

    useEffect(() => {
        if (activeMode !== LOADING_MODE) {
            setShowShowMoreButton(displayedFeedsOrdered.length === STANDARD_FEEDS_AMOUNT_TO_DISPLAY)
            setShowShowLessButton(displayedFeedsOrdered.length > STANDARD_FEEDS_AMOUNT_TO_DISPLAY)
        }
    }, [displayedFeedsOrdered])

    useEffect(() => {
        if (
            activeMode !== LOADING_MODE &&
            newLocalFeedData &&
            feedViewData.type !== 'karma' &&
            newLocalFeedData.projectId === projectId
        ) {
            const { feed, object, params } = newLocalFeedData

            if (feedViewData.type === 'user' || objectId === object.id) {
                if (params && params.editModeData) {
                    const { editModeData } = params
                    const { feedId, lastChangeDate } = editModeData
                    removedCommentFeedFromFeedsByDate(feedsByDate, lastChangeDate, object.id, feedId)
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
                    null
                )
            }
        }
    }, [newLocalFeedData])

    useEffect(() => {
        if (innerFeeds && activeMode !== FILTERING_MODE) {
            if (activeMode === LOADING_MODE) {
                setActiveMode(HISTORICAL_MODE)
            }
            processFeeds(maxAmountOfFeedToDisplay)
        }
    }, [innerFeeds])

    useEffect(() => {
        if (innerFeeds && activeMode === FILTERING_MODE) {
            setActiveMode(HISTORICAL_MODE)
            setShowShowLessButton(false)
            setShowShowMoreButton(false)
            setMaxAmountOfFeedToDisplay(STANDARD_FEEDS_AMOUNT_TO_DISPLAY)
            setFeedsOrderedArray([])
            const feedsToProcess = innerFeeds.slice(0, STANDARD_FEEDS_AMOUNT_TO_DISPLAY)

            processInitialFeeds(
                HISTORICAL_MODE,
                projectId,
                null,
                feedsToProcess,
                setFeedsByDate,
                setFeedsOrderedArray,
                setDisplayedFeedsOrdered,
                null,
                null
            )
        }
    }, [innerFeeds])

    return (
        <View>
            {feedsOrderedArray.map(dateFeeds => {
                const { formatedDate, feedObjects } = dateFeeds
                return (
                    <FeedsList
                        key={formatedDate}
                        projectId={projectId}
                        feedObjects={feedObjects}
                        feedViewData={feedViewData}
                        feedActiveTab={FOLLOWED_TAB}
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
