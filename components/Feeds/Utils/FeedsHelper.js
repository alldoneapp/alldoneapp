import moment from 'moment'

import { chronoKeysOrderDesc } from '../../../utils/HelperFunctions'
import Backend from '../../../utils/BackendBridge'
import { FEED_PUBLIC_FOR_ALL, FOLLOWED_TAB } from './FeedsConstants'
import { CREATION_TYPES, FOLLOWED_TYPES } from './HelperFunctions'
import store from '../../../redux/store'
import { checkIfSelectedAllProjects } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import FeedHelper from '../../FeedView/Utils/FeedHelper'

export const LOADING_MODE = 0
export const NEW_FEEDS_MODE = 1
export const HISTORICAL_MODE = 2
export const FILTERING_MODE = 3

export const MAX_FEEDS_AMOUNT_TO_DISPLAY = 99
export const STANDARD_FEEDS_AMOUNT_TO_DISPLAY = 20
export const ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY = 5

export const getInitialData = (feedActiveTab, counterNewFeedsData, followedFeeds, allFeeds) => {
    if (counterNewFeedsData.length > 0) {
        return {
            feedsToProcess: counterNewFeedsData,
            mode: NEW_FEEDS_MODE,
        }
    } else {
        const feedsToProcess = feedActiveTab === FOLLOWED_TAB ? followedFeeds : allFeeds
        return {
            feedsToProcess: feedsToProcess.slice(0, getLimitFeedAmountToDisplay()),
            mode: HISTORICAL_MODE,
        }
    }
}

export const getLimitFeedAmountToDisplay = () => {
    const { selectedProjectIndex } = store.getState()
    return checkIfSelectedAllProjects(selectedProjectIndex)
        ? ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY
        : STANDARD_FEEDS_AMOUNT_TO_DISPLAY
}

export const processInitialFeeds = async (
    activeMode,
    projectId,
    feedActiveTab,
    feeds,
    setFeedsByDate,
    setFeedsOrderedArray,
    setDisplayedFeedsOrdered,
    newFeedsIds,
    setNewFeedsIds
) => {
    const counterNewFeedsIds = []
    let showLikeNew = false
    if (activeMode === NEW_FEEDS_MODE) {
        showLikeNew = true
        Backend.resetAllNewFeeds(projectId, feedActiveTab)
    }

    const feedsByDate = {}
    const promises = []
    const promisesDate = []
    feeds.forEach(feed => {
        const { lastChangeDate, objectId, id, type } = feed
        const formatedDate = moment(lastChangeDate).format('YYYYMMDD')
        const dateFormatedInverted = moment(lastChangeDate).format('DDMMYYYY')
        if (feed.showLikeNew === undefined) {
            feed.showLikeNew = showLikeNew
            if (showLikeNew) {
                counterNewFeedsIds.push(id)
            }
        }

        const newFeedObject = { lastChangeDate, feeds: { [id]: feed } }
        const feedsInDate = feedsByDate[formatedDate]

        if (feedsInDate) {
            const feedObject = feedsInDate[objectId]
            if (feedObject) {
                feedObject.feeds[id] = feed
            } else {
                promisesDate.push(formatedDate)
                promises.push(Backend.getFeedObject(projectId, dateFormatedInverted, objectId, type, lastChangeDate))
                feedsInDate[objectId] = newFeedObject
            }
        } else {
            promisesDate.push(formatedDate)
            promises.push(Backend.getFeedObject(projectId, dateFormatedInverted, objectId, type, lastChangeDate))
            feedsByDate[formatedDate] = { [objectId]: newFeedObject }
        }
    })

    const objects = await Promise.all(promises)

    for (let i = 0; i < objects.length; i++) {
        const object = objects[i]
        object.isPrivate = object.isPublicFor && !object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        const { id } = object
        const date = promisesDate[i]
        if (object.type === 'user' || !FeedHelper.isPrivateTopic(object)) {
            feedsByDate[date][id].object = object
        } else {
            delete feedsByDate[date][id]
        }
    }

    if (setNewFeedsIds) {
        setNewFeedsIds([...newFeedsIds, ...counterNewFeedsIds])
    }
    updateFeedsState(feedsByDate, feeds, setFeedsByDate, setDisplayedFeedsOrdered, setFeedsOrderedArray, feedActiveTab)
}

export const updateFeedsState = (
    feedsByDate,
    displayedFeedsOrdered,
    setFeedsByDate,
    setDisplayedFeedsOrdered,
    setFeedsOrderedArray,
    feedActiveTab
) => {
    setFeedsByDate(feedsByDate)
    const feedsOrderedArray = transformFeedsObjectToFeedsOrderedArray(feedsByDate, feedActiveTab)
    setFeedsOrderedArray(feedsOrderedArray)
    setDisplayedFeedsOrdered(displayedFeedsOrdered)
}

const transformFeedsObjectToFeedsOrderedArray = (feedsByDate, feedActiveTab) => {
    const dates = Object.keys(feedsByDate).sort(chronoKeysOrderDesc)
    const feedsOrderedArray = dates.map(formatedDate => {
        const feedObjectsOrdered = Object.values(feedsByDate[formatedDate]).sort(orderByLastUpdatedDesc)
        const feedObjects = feedObjectsOrdered.map(feedObject => {
            const newFeedObject = { ...feedObject }
            const { object } = newFeedObject
            newFeedObject.feeds = Object.values(feedsByDate[formatedDate][object.id].feeds).sort(orderByLastUpdatedDesc)

            if (feedActiveTab === FOLLOWED_TAB) {
                newFeedObject.feeds = orderFeedsForFollowedTab(newFeedObject.feeds)
            }
            return newFeedObject
        })
        const invertFormatedDate =
            formatedDate.substring(6, 8) + formatedDate.substring(4, 6) + formatedDate.substring(0, 4)
        return { formatedDate: invertFormatedDate, feedObjects }
    })
    return feedsOrderedArray
}

const orderFeedsForFollowedTab = feeds => {
    const loggedUserId = store.getState().currentUser.uid
    let creationFeed
    let followedFeed
    const otherFeeds = []
    feeds.forEach(feed => {
        if (CREATION_TYPES.includes(feed.type)) {
            creationFeed = feed
        } else if (feed.creatorId === loggedUserId && FOLLOWED_TYPES.includes(feed.type)) {
            followedFeed = feed
        } else {
            otherFeeds.push(feed)
        }
    })
    let orderedFeeds = []
    if (followedFeed) {
        orderedFeeds.push(followedFeed)
    }
    if (creationFeed) {
        orderedFeeds.push(creationFeed)
    }
    orderedFeeds = [...otherFeeds, ...orderedFeeds]
    return orderedFeeds
}

const orderByLastUpdatedDesc = (a, b) => {
    return a.lastChangeDate < b.lastChangeDate ? 1 : -1
}

export const getNewFeedsForDisplay = (counterNewFeedsData, displayedFeedsOrdered, maxAmountOfFeedToDisplay) => {
    const amountOfNewFeeds = counterNewFeedsData.length
    const amountOfDisplayedFeeds = displayedFeedsOrdered.length
    const amountOfTotalFeeds = amountOfNewFeeds + amountOfDisplayedFeeds

    const newFeedsForDisplay =
        amountOfTotalFeeds > maxAmountOfFeedToDisplay
            ? displayedFeedsOrdered.slice(0, maxAmountOfFeedToDisplay - amountOfNewFeeds)
            : [...displayedFeedsOrdered]

    newFeedsForDisplay.splice(0, 0, ...counterNewFeedsData)
    return newFeedsForDisplay
}

export const existFeedInList = (feeds, feed) => {
    for (let i = 0; i < feeds.length > 0; i++) {
        if (feeds[i].id === feed.id) {
            return true
        }
    }
    return false
}

export const mergeLocalFeedInFeedsByDate = (feedsByDate, feed, object) => {
    const { lastChangeDate, objectId, id } = feed
    const formatedDate = moment(lastChangeDate).format('YYYYMMDD')

    if (feedsByDate[formatedDate]) {
        if (feedsByDate[formatedDate][objectId]) {
            feedsByDate[formatedDate][objectId].object = object
            feedsByDate[formatedDate][objectId].feeds[id] = feed
            feedsByDate[formatedDate][objectId].lastChangeDate = lastChangeDate
        } else {
            feedsByDate[formatedDate][objectId] = { lastChangeDate, object, feeds: { [id]: feed } }
        }
    } else {
        feedsByDate[formatedDate] = { [objectId]: { lastChangeDate, object, feeds: { [id]: feed } } }
    }
}

export const removeFeedFromFeedsByDate = (feedsByDate, feed) => {
    const { lastChangeDate, objectId, id } = feed
    const formatedDate = moment(lastChangeDate).format('YYYYMMDD')
    removeFeed(feedsByDate, formatedDate, objectId, id)
}

export const removedCommentFeedFromFeedsByDate = (feedsByDate, lastChangeDate, objectId, feedId) => {
    const formatedDate = moment(lastChangeDate).format('YYYYMMDD')
    removeFeed(feedsByDate, formatedDate, objectId, feedId)
}

const removeFeed = (feedsByDate, formatedDate, objectId, feedId) => {
    delete feedsByDate[formatedDate][objectId].feeds[feedId]

    if (Object.keys(feedsByDate[formatedDate][objectId].feeds).length === 0) {
        delete feedsByDate[formatedDate][objectId]
        if (Object.keys(feedsByDate[formatedDate]).length === 0) {
            delete feedsByDate[formatedDate]
        }
    }
}

const fillFeedsWithObjects = async (projectId, feedsForAdd, showLikeNew) => {
    const feedObjects = {}
    const promises = []
    feedsForAdd.forEach(feed => {
        const { objectId, lastChangeDate, type } = feed
        if (!feedObjects[objectId]) {
            feedObjects[objectId] = true
            const dateFormatedInverted = moment(lastChangeDate).format('DDMMYYYY')
            promises.push(Backend.getFeedObject(projectId, dateFormatedInverted, objectId, type, lastChangeDate))
        }
    })
    const objects = await Promise.all(promises)
    objects.forEach(object => {
        object.isPrivate = object.isPublicFor && !object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
        if (object.type === 'user' || !FeedHelper.isPrivateTopic(object)) {
            feedObjects[object.id] = object
        }
    })
    const forAddFeedsCloned = []
    const forAddFeedData = []
    feedsForAdd.forEach(feed => {
        const { objectId } = feed
        const clonedFeed = { ...feed, showLikeNew }
        forAddFeedsCloned.push(clonedFeed)
        forAddFeedData.push({
            feed: clonedFeed,
            object: feedObjects[objectId],
        })
    })
    return { forAddFeedData, forAddFeedsCloned }
}

export const mergeFeedsInFeedsByDate = async (
    projectId,
    feedsByDate,
    displayedFeedsOrdered,
    maxAmountOfFeedToDisplay,
    setFeedsByDate,
    setDisplayedFeedsOrdered,
    setFeedsOrderedArray,
    amountOfFeedsForAdd,
    amountOfTotalFeeds,
    feedsForAdd,
    showLikeNew,
    feedActiveTab
) => {
    const { forAddFeedData, forAddFeedsCloned } = await fillFeedsWithObjects(projectId, feedsForAdd, showLikeNew)

    forAddFeedData.forEach(data => {
        const { feed, object } = data
        mergeLocalFeedInFeedsByDate(feedsByDate, feed, object)
    })

    let newFeedsForDisplay
    if (amountOfTotalFeeds > maxAmountOfFeedToDisplay) {
        const lastFeeds = displayedFeedsOrdered.slice(maxAmountOfFeedToDisplay - amountOfFeedsForAdd)
        lastFeeds.forEach(feed => {
            removeFeedFromFeedsByDate(feedsByDate, feed)
        })
        newFeedsForDisplay = [
            ...forAddFeedsCloned,
            ...displayedFeedsOrdered.slice(0, maxAmountOfFeedToDisplay - amountOfFeedsForAdd),
        ]
    } else {
        newFeedsForDisplay = [...forAddFeedsCloned, ...displayedFeedsOrdered]
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

export const removeFeedObjectFromFeedsByDate = (feedsByDate, object) => {
    const { lastChangeDate, id } = object
    const formatedDate = moment(lastChangeDate).format('YYYYMMDD')

    if (feedsByDate[formatedDate] && feedsByDate[formatedDate][id]) {
        delete feedsByDate[formatedDate][id]
        if (Object.keys(feedsByDate[formatedDate]).length === 0) {
            delete feedsByDate[formatedDate]
        }
    }
}

export const calcUpdatesAmount = () => {
    const { selectedProjectIndex: index, updatesAmounts } = store.getState()

    if (checkIfSelectedAllProjects(index)) {
        return updatesAmounts.reduceRight((a, b) => (a || 0) + (b || 0), 0)
    } else {
        return updatesAmounts[index] || 0
    }
}
