/**
 * NoteModelBuilder - Simple note model builder
 * Mock implementation for testing purposes
 */

function createNoteObject(params) {
    const {
        taskId: noteId,
        title,
        extendedTitle,
        userId,
        projectId,
        now = Date.now(),
        isPrivate = false,
        isPublicFor = ['FEED_PUBLIC_FOR_ALL'],
    } = params

    return {
        id: noteId,
        title: title ? title.toLowerCase() : '',
        extendedTitle: extendedTitle || title || '',
        description: params.description || '',
        userId,
        creatorId: userId,
        projectId,
        isPrivate,
        isPublicFor,
        isVisibleInFollowedFor: isPublicFor,
        createdAt: now,
        lastEditionDate: now,
        lastEditorId: userId,
        commentsData: {
            amount: 0,
            lastComment: '',
            lastCommentType: '',
        },
        hasStar: '#ffffff',
        shared: false,
        views: 0,
        followersIds: [userId],
        stickyData: {
            days: 0,
            stickyEndDate: 0,
        },
        versionId: 'CURRENT_DAY_VERSION_ID',
        parentObject: params.parentObject || null,
        assistantId: params.assistantId || null,
        preview: params.preview || '',
    }
}

module.exports = {
    createNoteObject,
    default: { createNoteObject },
}
