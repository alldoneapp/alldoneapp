export const shouldDisplayLocalFeedInDetailedView = (objectId, localFeedObject) => {
    return !!localFeedObject && objectId === localFeedObject.id
}

export const filterUserObjectFeeds = (feeds, userId) => {
    return Array.isArray(feeds) ? feeds.filter(feed => feed.objectId === userId) : feeds
}
