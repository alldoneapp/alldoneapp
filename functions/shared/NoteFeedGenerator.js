/**
 * NoteFeedGenerator - Simple note feed generator
 * Mock implementation for testing purposes
 */

const FEED_PUBLIC_FOR_ALL = 'FEED_PUBLIC_FOR_ALL'

function createTaskEventFeed(eventType, params) {
    const { projectId, taskId: noteId, feedUser, moment } = params

    const now = Date.now()
    const feedId = `note_${eventType}_${noteId}_${now}`

    return {
        feedId,
        feed: {
            id: feedId,
            type: `FEED_NOTE_${eventType.toUpperCase()}`,
            createdAt: now,
            projectId,
            objectId: noteId,
            userId: feedUser?.uid || feedUser?.id,
            entryText: `${eventType} note`,
        },
        noteFeedObject: {
            type: 'note',
            noteId,
            name: params.note?.title || params.note?.extendedTitle || 'Untitled Note',
            userId: feedUser?.uid || feedUser?.id,
            isPublicFor: [FEED_PUBLIC_FOR_ALL],
            lastChangeDate: now,
        },
        currentDateFormated: new Date().toISOString().split('T')[0],
    }
}

module.exports = {
    createTaskEventFeed,
    FEED_PUBLIC_FOR_ALL,
    default: { createTaskEventFeed, FEED_PUBLIC_FOR_ALL },
}
