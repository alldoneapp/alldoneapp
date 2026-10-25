export function selectNewFeeds(newFeeds, amountFeedsToShow, userId) {
    const newFeedsData = { feedsAmount: 0, feedsData: [] }

    if (!newFeeds) {
        return newFeedsData
    }

    const objectTypes = Object.keys(newFeeds)
    const linealFeeds = []
    const updatedObjects = new Set()

    for (let t = 0; t < objectTypes.length; t++) {
        const type = objectTypes[t]
        const objectsIds = Object.keys(newFeeds[type])

        for (let i = 0; i < objectsIds.length; i++) {
            const objectId = objectsIds[i]
            const feeds = newFeeds[type][objectId]

            if (!feeds.isPrivate || feeds.isPrivate === userId) {
                const feedsIds = Object.keys(feeds).filter(feedId => feedId !== 'isPrivate')
                let objectHasVisibleFeed = false

                for (let n = 0; n < feedsIds.length; n++) {
                    const feedId = feedsIds[n]
                    const feedData = feeds[feedId]

                    if (feedData?.feed) {
                        objectHasVisibleFeed = true
                        feedData.feed.id = feedId
                        feedData.feed.objectId = objectId
                        feedData.feed.objectTypes = type
                        // The day the writer filed the feed object under. The server writes in UTC,
                        // so re-deriving it from lastChangeDate in the browser can name the wrong day.
                        if (feedData.dateFormated) feedData.feed.dateFormated = feedData.dateFormated
                        linealFeeds.push(feedData.feed)
                    }
                }

                if (objectHasVisibleFeed) {
                    updatedObjects.add(`${type}/${objectId}`)
                }
            }
        }
    }

    orderFeedsByDate(linealFeeds)

    newFeedsData.feedsAmount = updatedObjects.size
    newFeedsData.feedsData = linealFeeds.slice(0, amountFeedsToShow)

    return newFeedsData
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
