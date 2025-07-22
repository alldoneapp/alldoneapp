const { uniq, difference } = require('lodash')
const moment = require('moment')
const admin = require('firebase-admin')

const { logEvent } = require('../GAnalytics/GAnalytics')
const {
    FEED_PUBLIC_FOR_ALL,
    DATE_FORMAT_EUROPE,
    ESTIMATION_TYPE_TIME,
    ESTIMATION_TYPE_POINTS,
    TIME_TEXT_DEFAULT,
    TIME_TEXT_DEFAULT_SHORT,
    TIME_MINI,
    TIME_MINI_SHORT,
    TIME_HOURS,
    TIME_HOURS_MINI,
    TIME_TEXT_DEFAULT_MINI,
    ESTIMATION_OPTIONS,
    ESTIMATION_POINTS_VALUES,
    ESTIMATION_0_MIN,
    ESTIMATION_15_MIN,
    ESTIMATION_30_MIN,
    ESTIMATION_1_HOUR,
    ESTIMATION_2_HOURS,
    ESTIMATION_4_HOURS,
    ESTIMATION_8_HOURS,
    ESTIMATION_16_HOURS,
} = require('../Utils/HelperFunctionsCloud')
const { getId } = require('../Firestore/generalFirestoreCloud')
const {
    FEED_CONTACT_ADDED,
    FEED_CONTACT_FOLLOWED,
    FOLLOWED_TAB,
    ALL_TAB,
    BOTH_TABS,
    MAX_AMOUNT_OF_FEEDS_STORED,
} = require('./FeedsConstants')
const { getGlobalState } = require('../GlobalState/globalState')
const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

const initialDates = {
    'Initial of Minutes': 'm',
    'Initial of Hour': 'H',
    'Initial of Hours': 'H',
    'Initial of Day': 'D',
    'Initial of Days': 'D',
    'Initial of Month': 'M',
    'Initial of Months': 'M',
    'Initial of Year': 'Y',
    'Initial of Years': 'Y',
}

function getMentionIdsFromTitle(title) {
    const words = title.split(' ')
    const ids = []
    for (let i = 0; i < words.length; i++) {
        if (words[i].startsWith('@')) {
            const parts = words[i].split('#')
            if (parts.length === 2 && parts[1].trim().length >= 28) {
                ids.push(parts[1].trim())
            }
        }
    }
    return uniq(ids)
}

function getMentionedUsersIdsWhenEditText(newText, oldText) {
    const newMentionsIds = getMentionIdsFromTitle(newText)
    const oldMentionsIds = getMentionIdsFromTitle(oldText)
    return difference(newMentionsIds, oldMentionsIds)
}

function insertFollowersUserToFeedChain(followerIds, objectId, batch) {
    batch.feedChainFollowersIds = { [objectId]: followerIds }
}

function generateCurrentDateObject() {
    const currentDate = moment()
    const currentDateFormated = currentDate.format('DDMMYYYY')
    const currentMilliseconds = currentDate.valueOf()
    return { currentDate, currentDateFormated, currentMilliseconds }
}

function generateFeedModel({ feedType, lastChangeDate, entryText, feedUser, objectId, isPublicFor }) {
    const { uid } = feedUser

    const feed = {
        type: feedType,
        lastChangeDate,
        creatorId: uid,
        objectId,
        isPublicFor: isPublicFor ? isPublicFor : [FEED_PUBLIC_FOR_ALL],
    }

    if (entryText) feed.entryText = entryText

    const feedId = getId()
    return { feed, feedId }
}

async function storeOldFeeds(projectId, formatedDate, feedObjectId, feedObject, feedId, feed, batch) {
    const feedObjectRef = admin.firestore().doc(`oldFeeds/${projectId}/${formatedDate}/${feedObjectId}`)
    const feedRef = admin.firestore().doc(`oldFeeds/${projectId}/${formatedDate}/${feedObjectId}/feeds/${feedId}`)
    batch.set(feedObjectRef, feedObject, { merge: true })
    batch.set(feedRef, feed)

    await logEvent('', 'update_feeds', {
        objectId: feedObjectId,
        objectType: feedObject.type,
        feedId: feedId,
        feedType: feed.type,
    })
}

async function cleanStoreFeeds(projectId, userIds) {
    const promises = []
    promises.push(deleteOldFeeds(`feedsStore/${projectId}/all`))

    userIds.forEach(userId => {
        promises.push(deleteOldFeeds(`feedsStore/${projectId}/${userId}/feeds/followed`))
    })
    await Promise.all(promises)
}

async function cleanInnerFeeds(projectId, objectId, objectTypes) {
    await deleteOldFeeds(`projectsInnerFeeds/${projectId}/${objectTypes}/${objectId}/feeds`)
}

async function deleteOldFeeds(path) {
    const feedsDocs = (await admin.firestore().collection(path).orderBy('lastChangeDate', 'desc').get()).docs
    const feedsIds = []
    feedsDocs.forEach(function (doc) {
        feedsIds.push(doc.id)
    })

    feedsIds.splice(0, MAX_AMOUNT_OF_FEEDS_STORED)
    const promises = []
    feedsIds.forEach(id => {
        promises.push(admin.firestore().doc(`${path}/${id}`).delete())
    })
    await Promise.all(promises)
}

async function cleanNewFeeds(projectId, projectUsersIds) {
    const promises = []
    projectUsersIds.forEach(userId => {
        promises.push(cleanNewFeedsTab(projectId, userId, 'followed'))
        promises.push(cleanNewFeedsTab(projectId, userId, 'all'))
    })
    await Promise.all(promises)
}

async function cleanNewFeedsTab(projectId, userId, tab) {
    const newFeeds = (await admin.firestore().doc(`/feedsCount/${projectId}/${userId}/${tab}`).get()).data()
    const linealFeeds = parseNewFeeds(newFeeds)

    const toLeftNewFeeds = linealFeeds.splice(0, MAX_AMOUNT_OF_FEEDS_STORED)
    const newFeedsObject = parseInvertedNewFeeds(toLeftNewFeeds)

    await admin.firestore().doc(`/feedsCount/${projectId}/${userId}/${tab}`).set(newFeedsObject)
}

function parseNewFeeds(newFeeds) {
    const linealFeeds = []
    if (newFeeds) {
        const objectTypes = Object.keys(newFeeds)
        if (objectTypes.length > 0) {
            for (let t = 0; t < objectTypes.length; t++) {
                const type = objectTypes[t]
                const objectsIds = Object.keys(newFeeds[type])
                if (objectsIds.length > 0) {
                    for (let i = 0; i < objectsIds.length; i++) {
                        const objectId = objectsIds[i]
                        const feeds = newFeeds[type][objectId]
                        const feedsIds = Object.keys(feeds)

                        for (let n = 0; n < feedsIds.length; n++) {
                            const feedId = feedsIds[n]
                            const feed = feeds[feedId].feed
                            const dateFormated = feeds[feedId].dateFormated
                            feed.id = feedId
                            feed.objectId = objectId
                            feed.objectTypes = type
                            feed.dateFormated = dateFormated
                            linealFeeds.push(feed)
                        }
                    }
                }
            }
        }
    }
    orderFeedsByDate(linealFeeds)
    return linealFeeds
}

function orderFeedsByDate(feedsData) {
    feedsData.sort(function (a, b) {
        if (a.lastChangeDate > b.lastChangeDate) {
            return -1
        }
        if (a.lastChangeDate < b.lastChangeDate) {
            return 1
        }
        return 0
    })
}

function parseInvertedNewFeeds(newFeeds) {
    let newFeedsObject = {}
    newFeeds.forEach(newFeed => {
        const { id, objectId, dateFormated, objectTypes } = newFeed
        delete newFeed.id
        delete newFeed.dateFormated
        delete newFeed.objectTypes

        const cleanFeed = { dateFormated, feed: newFeed }
        const cleanObject = { [id]: cleanFeed }
        if (newFeedsObject[objectTypes]) {
            if (newFeedsObject[objectTypes][objectId]) {
                newFeedsObject[objectTypes][objectId] = {
                    ...newFeedsObject[objectTypes][objectId],
                    [id]: cleanFeed,
                }
            } else {
                newFeedsObject[objectTypes] = { ...newFeedsObject[objectTypes], [objectId]: cleanObject }
            }
        } else {
            newFeedsObject = { ...newFeedsObject, [objectTypes]: { [objectId]: cleanObject } }
        }
    })
    return newFeedsObject
}

async function setFeedObjectLastState(projectId, objectType, objectId, objectLastState, batch) {
    const stateRef = admin.firestore().doc(`/feedsObjectsLastStates/${projectId}/${objectType}/${objectId}`)
    batch.set(stateRef, objectLastState, { merge: true })
}

async function getObjectFollowersIds(projectId, objectsType, objectId) {
    const followersIds = (await admin.firestore().doc(`followers/${projectId}/${objectsType}/${objectId}`).get()).data()
    return followersIds && followersIds.usersFollowing ? followersIds.usersFollowing : []
}

async function storeFollowersInBatch(projectId, objectsType, objectId, feedUser, batch) {
    if (!batch.followersIds || !batch.followersIds[objectId]) {
        const followersIds = await getObjectFollowersIds(projectId, objectsType, objectId)
        const feedChainFollowersIds =
            batch.feedChainFollowersIds && batch.feedChainFollowersIds[objectId]
                ? batch.feedChainFollowersIds[objectId]
                : []
        const totalFollowersIds = uniq([...followersIds, ...feedChainFollowersIds, feedUser.uid])
        batch.followersIds = { ...batch.followersIds, [objectId]: totalFollowersIds }
    }
}

function generateFeedCounterEntry(currentDateFormated, objectsType, objectId, feedId, feed) {
    const entryData = {
        dateFormated: currentDateFormated,
        feed,
    }

    return {
        [objectsType]: { [objectId]: { [feedId]: entryData } },
    }
}

function storeAllTabFeeds(projectId, feedId, feed, batch) {
    batch.set(admin.firestore().doc(`/feedsStore/${projectId}/all/${feedId}`), feed, {
        merge: true,
    })
}

function storeFollowedTabFeeds(projectId, userId, feedId, feed, batch) {
    batch.set(admin.firestore().doc(`/feedsStore/${projectId}/${userId}/feeds/followed/${feedId}`), feed, {
        merge: true,
    })
}

function increaseFeedCount(
    currentDateFormated,
    projectUsersIdsForSpecialFeeds,
    projectId,
    objectsType,
    objectId,
    batch,
    feedId,
    feed,
    feedObject,
    needGenerateNotification
) {
    const { feedCreator, project } = getGlobalState()

    const followersIds = batch.followersIds[objectId]

    storeAllTabFeeds(projectId, feedId, feed, batch)

    followersIds.forEach(userId => {
        storeFollowedTabFeeds(projectId, userId, feedId, feed, batch)
    })

    if (needGenerateNotification) {
        const usersWithAccessIds =
            feed.isPublicFor && !feed.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
                ? feed.isPublicFor
                : projectUsersIdsForSpecialFeeds.length > 0
                ? projectUsersIdsForSpecialFeeds
                : project.userIds

        const usersToNotifyIds = usersWithAccessIds.filter(userId => userId !== feedCreator.uid)

        const entryObjectsCounter = generateFeedCounterEntry(currentDateFormated, objectsType, objectId, feedId, feed)

        usersToNotifyIds.forEach(userId => {
            const newFeedNotificationPath = followersIds.includes(userId) ? 'followed' : 'all'
            increaseNewFeedCount(
                projectId,
                userId,
                objectsType,
                objectId,
                batch,
                feed,
                feedObject,
                newFeedNotificationPath,
                entryObjectsCounter
            )
        })
    }
}

async function increaseNewFeedCount(
    projectId,
    userId,
    objectsType,
    objectId,
    batch,
    feed,
    feedObject,
    notificationPath,
    entryObjectsCounter
) {
    batch.set(admin.firestore().doc(`/feedsCount/${projectId}/${userId}/${notificationPath}`), entryObjectsCounter, {
        merge: true,
    })

    /* if (objectsType !== 'notes' && objectsType !== 'goals' && objectsType !== 'skills'&& objectsType !== 'assistants') {
        registerFeedEmail(projectId, userId, objectsType, objectId, feed, feedObject)
        sendPushNotifications(projectId, userId, objectsType, objectId, feed, feedObject)
    }*/
}

function setLastActionDate(projectId, lastActionDate, batch) {
    if (!batch.lastActionDate) {
        batch.lastActionDate = lastActionDate
        batch.set(admin.firestore().doc(`projects/${projectId}`), { lastActionDate }, { merge: true })
    }
}

function globalInnerFeedsGenerator(projectId, objectTypes, feedObjectId, feed, feedId, batch, disabledLastInteraction) {
    batch.set(
        admin.firestore().doc(`projectsInnerFeeds/${projectId}/${objectTypes}/${feedObjectId}/feeds/${feedId}`),
        feed
    )

    setLastActionDate(projectId, feed.lastChangeDate, batch)
}

function deleteObjectFeedCounter(projectId, userId, objectId, objectTypes, tabsToRemove, batch) {
    const { admin } = getGlobalState()

    const entryObjectsCounter = {
        [objectTypes]: { [objectId]: admin.firestore.FieldValue.delete() },
    }

    if (tabsToRemove === FOLLOWED_TAB || tabsToRemove === BOTH_TABS) {
        batch.set(admin.firestore().doc(`/feedsCount/${projectId}/${userId}/followed`), entryObjectsCounter, {
            merge: true,
        })
    }
    if (tabsToRemove === ALL_TAB || tabsToRemove === BOTH_TABS) {
        batch.set(admin.firestore().doc(`/feedsCount/${projectId}/${userId}/all`), entryObjectsCounter, {
            merge: true,
        })
    }
}

async function getFeedObjectLastState(projectId, objectType, objectId) {
    const objectLastState = await admin
        .firestore()
        .doc(`/feedsObjectsLastStates/${projectId}/${objectType}/${objectId}`)
        .get()
    return objectLastState.data()
}

async function loadFeedObject(projectId, objectId, objectTypes, lastChangeDate, batch) {
    let feedObject
    if (batch.feedObjects && batch.feedObjects[objectId]) {
        feedObject = batch.feedObjects[objectId]
        feedObject.lastChangeDate = lastChangeDate
    } else {
        feedObject = await getFeedObjectLastState(projectId, objectTypes, objectId)
        if (feedObject) {
            batch.feedObjects = { ...batch.feedObjects, [objectId]: feedObject }
            feedObject.lastChangeDate = lastChangeDate
        }
    }
    return feedObject
}

async function deleteObjectFeedStore(projectId, userId, objectId, path) {
    const feedsToDelete = (
        await admin
            .firestore()
            .collection(`/feedsStore/${projectId}/${userId}/feeds/${path}`)
            .where('objectId', '==', objectId)
            .get()
    ).docs

    const batch = new BatchWrapper(admin.firestore())
    feedsToDelete.forEach(feedDoc => {
        batch.delete(admin.firestore().doc(`/feedsStore/${projectId}/${userId}/feeds/${path}/${feedDoc.id}`))
    })
    await batch.commit()
}

async function updateInnerFeedsPrivacy(objectId, path, isPublicFor, batch) {
    const feeds = (await admin.firestore().collection(path).where('objectId', '==', objectId).get()).docs
    feeds.forEach(feedDoc => {
        const feed = feedDoc.data()
        const usersWithAccess = [...isPublicFor]
        if (feed.isCommentPublicFor) {
            feed.isCommentPublicFor.forEach(userId => {
                if (!usersWithAccess.includes(userId)) {
                    usersWithAccess.push(userId)
                }
            })
        }
        batch.set(db.doc(`${path}/${feedDoc.id}`), { isPublicFor: usersWithAccess }, { merge: true })
    })
}

async function addPrivacyForFeedObject(projectId, isPrivate, feedObject, objectId, objectTypes, isPublicFor) {
    const { users } = getGlobalState()
    const batch = new BatchWrapper(admin.firestore())
    feedObject.isPublicFor = isPublicFor

    const userIds = users.map(user => user.uid)

    const promises = []
    if (isPrivate) {
        const userIdsWithoutAccess = userIds.filter(userId => !isPublicFor.includes(userId))
        userIdsWithoutAccess.forEach(userId => {
            deleteObjectFeedCounter(projectId, userId, objectId, objectTypes, BOTH_TABS, batch)
            promises.push(deleteObjectFeedStore(projectId, userId, objectId, 'followed'))
        })
    }

    const followersWithAccessIds = isPublicFor[0] === FEED_PUBLIC_FOR_ALL ? userIds : isPublicFor
    followersWithAccessIds.forEach(userId => {
        promises.push(
            updateInnerFeedsPrivacy(objectId, `/feedsStore/${projectId}/${userId}/feeds/followed`, isPublicFor, batch)
        )
    })

    promises.push(updateInnerFeedsPrivacy(objectId, `/feedsStore/${projectId}/all`, isPublicFor, batch))
    promises.push(
        updateInnerFeedsPrivacy(
            objectId,
            `projectsInnerFeeds/${projectId}/${objectTypes}/${objectId}/comments`,
            isPublicFor,
            batch
        )
    )
    promises.push(
        updateInnerFeedsPrivacy(
            objectId,
            `projectsInnerFeeds/${projectId}/${objectTypes}/${objectId}/feeds`,
            isPublicFor,
            batch
        )
    )
    promises.push(batch.commit())
    await Promise.all(promises)
}

const getDateFormat = () => {
    const { feedCreator } = getGlobalState()
    const dateFormat = feedCreator.dateFormat || DATE_FORMAT_EUROPE
    return dateFormat.substr(0, 5)
}

const getEstimationType = () => {
    const { project } = getGlobalState()
    return project.estimationType || ESTIMATION_TYPE_TIME
}

const getDoneTimeValue = (estimation, template = TIME_TEXT_DEFAULT) => {
    const estimationResume = getEstimationResume(null, estimation, ESTIMATION_TYPE_TIME)
    const hours = estimationResume.hours > 0 ? ` (${estimationResume.hours} 'hours')` : ''
    const hoursMini =
        estimationResume.hours > 0 ? ` (${estimationResume.hours}${initialDates['Initial of Hours']})` : ''

    let finalText = ''
    switch (template) {
        case TIME_TEXT_DEFAULT:
            finalText = `${estimationResume.value} ${estimationResume.text}${hours}`
            break
        case TIME_TEXT_DEFAULT_SHORT:
            finalText = `${estimationResume.value} ${initialDates[`Initial of ${estimationResume.text}`]}`
            break
        case TIME_MINI:
            finalText = `${estimationResume.value}${estimationResume.text}${hoursMini}`.toLowerCase()
            break
        case TIME_MINI_SHORT:
            finalText = `${estimationResume.value}${initialDates[`Initial of ${estimationResume.text}`].toLowerCase()}`
            break
        case TIME_TEXT_DEFAULT_MINI:
            finalText = `${estimationResume.value}${
                initialDates[`Initial of ${estimationResume.text}`]
            }${hoursMini}`.toLowerCase()
            break
        case TIME_HOURS:
            finalText = `${estimationResume.hours} ${'hours'}`
            break
        case TIME_HOURS_MINI:
            finalText = `${estimationResume.hours}${initialDates['Initial of Hours']}`.toLowerCase()
            break
        default:
            finalText = `${estimationResume.value} ${estimationResume.text}${hours}`
            break
    }

    return finalText
}

const getEstimationResume = (projectId, estimation, customEstimationType) => {
    const { project } = getGlobalState()
    let estimationType = ''

    if (customEstimationType != null) {
        estimationType = customEstimationType
    } else if (projectId != null) {
        estimationType = project.estimationType
    } else {
        estimationType = ESTIMATION_TYPE_TIME
    }

    if (estimationType === ESTIMATION_TYPE_POINTS) {
        return { value: estimation, text: estimation <= 1 ? 'Point' : 'Points', hours: 0 }
    } else {
        // default for less than an hour
        let resume = estimation
        let text = 'Minutes'
        let hours = estimation < 60 ? 0 : parseFloat((estimation / 60).toFixed(1))

        // "estimation" value is in MINUTES

        // Use parseFloat because toFixed returns a string
        switch (true) {
            case estimation === 60: // 1 hour
                resume = 1
                text = 'Hour'
                break
            case 60 < estimation && estimation < 480: // 8 hours
                resume = parseFloat((estimation / 60).toFixed(2))
                text = 'Hours'
                break
            case estimation === 480: // 1 day
                resume = 1
                text = 'Day'
                break
            case 480 < estimation && estimation < 10560: // between 1 day & 1 month (1 day === 8 hours) (1 month === 22 days)
                resume = parseFloat((estimation / 480).toFixed(2))
                text = 'Days'
                break
            case estimation === 10560: // 1 month
                resume = 1
                text = 'Month'
                break
            case 10560 < estimation && estimation < 126720: // between 1 month & 1 year (1 year === 12 months)
                resume = parseFloat((estimation / 10560).toFixed(2))
                text = 'Months'
                break
            case estimation === 126720: // 1 year
                resume = 1
                text = 'Year'
                break
            case 126720 < estimation: // more than 1 year
                resume = parseFloat((estimation / 126720).toFixed(2))
                text = 'Years'
                break
        }

        return { value: resume, text: text, hours: hours }
    }
}

const getEstimationRealValue = (projectId, estimation, customEstimationType) => {
    const { project } = getGlobalState()
    let estimationType = ''

    if (customEstimationType != null) {
        estimationType = customEstimationType
    } else if (projectId != null) {
        estimationType = project.estimationType
    } else {
        estimationType = ESTIMATION_TYPE_TIME
    }

    if (estimationType === ESTIMATION_TYPE_TIME) {
        return estimation
    } else {
        // Estimation value in DB is Predefined in ESTIMATION_OPTIONS
        if (ESTIMATION_OPTIONS.includes(estimation)) {
            return ESTIMATION_POINTS_VALUES[estimation]
        } else {
            // If Estimation value is Custom, then we need to approximate
            switch (true) {
                case estimation <= 11: // less than 11m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_0_MIN]
                case 11 < estimation && estimation <= 22: // between 11m & 22m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_15_MIN]
                case 22 < estimation && estimation <= 45: // between 22m & 45m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_30_MIN]
                case 45 < estimation && estimation <= 90: // between 45m & 1h30m
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_1_HOUR]
                case 90 < estimation && estimation <= 180: // between 1h30m & 3h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_2_HOURS]
                case 180 < estimation && estimation <= 360: // between 3h & 6h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_4_HOURS]
                case 360 < estimation && estimation <= 720: // between 6h & 12h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_8_HOURS]
                case 720 < estimation: // more than 12h
                    return ESTIMATION_POINTS_VALUES[ESTIMATION_16_HOURS]
            }
        }
    }
}

async function proccessFeed(
    projectId,
    currentDateFormated,
    projectUsersIdsForSpecialFeeds,
    objectId,
    objectsType,
    feedObject,
    feedId,
    feed,
    feedUser,
    batch,
    needGenerateNotification
) {
    updateFeedObject(projectId, currentDateFormated, objectId, feedObject, objectsType, batch)

    const promises = []
    promises.push(storeOldFeeds(projectId, currentDateFormated, objectId, feedObject, feedId, feed, batch))
    promises.push(storeFollowersInBatch(projectId, objectsType, objectId, feedUser, batch))
    await Promise.all(promises)

    increaseFeedCount(
        currentDateFormated,
        projectUsersIdsForSpecialFeeds,
        projectId,
        objectsType,
        objectId,
        batch,
        feedId,
        feed,
        feedObject,
        needGenerateNotification
    )
    globalInnerFeedsGenerator(projectId, objectsType, objectId, feed, feedId, batch)
}

function updateFeedObject(projectId, currentDateFormated, objectId, feedObject, objectsType, batch) {
    const feedObjectRef = admin.firestore().doc(`/projectsFeeds/${projectId}/${currentDateFormated}/${objectId}`)
    batch.set(feedObjectRef, feedObject, { merge: true })
    setFeedObjectLastState(projectId, objectsType, objectId, feedObject, batch)
}

async function cleanGlobalFeeds(projectId) {
    const { project } = getGlobalState()
    const { userIds: projectUsersIds } = project
    const promises = []
    promises.push(cleanStoreFeeds(projectId, projectUsersIds))
    promises.push(cleanNewFeeds(projectId, projectUsersIds))
    await Promise.all(promises)
}

async function cleanObjectFeeds(projectId, objectId, objectsType) {
    const { feedCreator } = getGlobalState()
    const promises = []
    promises.push(cleanInnerFeeds(projectId, objectId, objectsType))
    promises.push(cleanInnerFeeds(projectId, feedCreator.uid, 'users'))
    await Promise.all(promises)
}

async function cleanFeeds(projectId, objectId, objectsType) {
    const promises = []
    promises.push(cleanGlobalFeeds(projectId))
    promises.push(cleanObjectFeeds(projectId, objectId, objectsType))
    await Promise.all(promises)
}

module.exports = {
    getMentionedUsersIdsWhenEditText,
    insertFollowersUserToFeedChain,
    generateCurrentDateObject,
    generateFeedModel,
    setFeedObjectLastState,
    loadFeedObject,
    getFeedObjectLastState,
    deleteObjectFeedCounter,
    addPrivacyForFeedObject,
    getDateFormat,
    getEstimationType,
    getEstimationResume,
    getDoneTimeValue,
    getEstimationRealValue,
    proccessFeed,
    cleanFeeds,
    cleanGlobalFeeds,
    cleanObjectFeeds,
    getMentionIdsFromTitle,
    getObjectFollowersIds,
}
