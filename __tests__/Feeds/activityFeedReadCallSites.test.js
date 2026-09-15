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

    it('clears activity unread state in the task batch for every task transition path', () => {
        const source = read('utils/backends/Tasks/tasksFirestore.js')
        const helper = readFunction(
            source,
            'const queueTaskTransitionActivityFeedUnreadClear =',
            'export async function moveTasksFromMiddleOfWorkflow('
        )
        const transitionFunctions = [
            readFunction(
                source,
                'export async function moveTasksFromMiddleOfWorkflow(',
                'const getTaskCompletedTime ='
            ),
            readFunction(
                source,
                'export async function moveTasksFromOpen(',
                'export async function moveTasksFromDone('
            ),
            readFunction(source, 'export async function moveTasksFromDone(', 'export async function setTaskStatus('),
        ]

        expect(helper).toContain('queueObjectActivityFeedUnreadClear(getDb(), batch, {')
        expect(helper).toContain("objectType: 'tasks'")
        expect(helper).toContain('userId: store.getState().loggedUser.uid')

        transitionFunctions.forEach(transitionFunction => {
            const clearIndex = transitionFunction.indexOf(
                'queueTaskTransitionActivityFeedUnreadClear(projectId, task.id, batch)'
            )
            const commitIndex = transitionFunction.indexOf('batch.commit()')

            expect(clearIndex).toBeGreaterThan(-1)
            expect(commitIndex).toBeGreaterThan(clearIndex)
        })
    })
})
