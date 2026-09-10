const fs = require('fs')
const path = require('path')

const read = relativePath => fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')

const readFunction = (source, signature, nextSignature) => {
    const start = source.indexOf(signature)
    const end = source.indexOf(nextSignature, start)
    return source.slice(start, end === -1 ? source.length : end)
}

describe('activity-feed unread interaction call sites', () => {
    it('clears both activity tabs when the signed-in user authors a feed entry', () => {
        const source = read('utils/backends/firestore.js')
        const increaseFeedCount = readFunction(
            source,
            'export async function increaseFeedCount(',
            'async function getObjectFollowers('
        )

        expect(increaseFeedCount).toContain('isUserAuthoredFeed(feed, loggedUserId)')
        expect(increaseFeedCount).toContain('queueObjectActivityFeedUnreadClear(db, batch, {')
        expect(increaseFeedCount).toContain('userId: loggedUserId')
        expect(increaseFeedCount).toContain('objectType: objectsType')
    })

    it('clears activity unread state for new comments, but keeps edits and chat unread state separate', () => {
        const source = read('utils/backends/Chats/chatsComments.js')
        const storeComment = readFunction(
            source,
            'const storeComment = async (',
            'const generatePushAndEmailNotifcations'
        )
        const newCommentBranch = readFunction(
            storeComment,
            'if (isNewComment(editingCommentId)) {',
            'batch.set(\n        getDb().doc(`chatComments/'
        )

        expect(newCommentBranch).toContain('queueObjectActivityFeedUnreadClear(getDb(), batch, {')
        expect(newCommentBranch).toContain('userId: creatorId')
        expect(newCommentBranch).toContain('objectType,')
        expect(newCommentBranch).not.toContain('chatNotifications/${projectId}/${creatorId}')
    })
})
