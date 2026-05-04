export const getDetailedViewFeedObjectIds = (objectId, relatedObjectIds = []) => {
    return [...new Set([objectId, ...relatedObjectIds].filter(Boolean))]
}

export const getAttachedNoteId = (object, projectId) => {
    return object?.noteId || object?.noteIdsByProject?.[projectId]
}

export const getAttachedNoteFeedSource = noteId => {
    return noteId ? { objectTypes: 'notes', feedObjectId: noteId } : null
}

export const shouldDisplayLocalFeedInDetailedView = (objectId, localFeedObject, relatedObjectIds = []) => {
    return !!localFeedObject && getDetailedViewFeedObjectIds(objectId, relatedObjectIds).includes(localFeedObject.id)
}

export const filterDetailedViewFeeds = (feeds, objectId, relatedObjectIds = []) => {
    const feedObjectIds = getDetailedViewFeedObjectIds(objectId, relatedObjectIds)
    return Array.isArray(feeds) ? feeds.filter(feed => feedObjectIds.includes(feed.objectId)) : feeds
}
