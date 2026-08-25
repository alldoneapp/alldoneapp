import {
    captureChatNotifications,
    clearChatCommentsForLinkedEmails,
    collectUnreadCommentRefs,
    getCommentRefsFromLinkedEmails,
    markAlldoneChatsReadForLinkedEmails,
    markChatCommentsAsRead,
    markChatCommentsAsReadByMessageIds,
    restoreChatNotifications,
} from './markChatCommentsAsRead'
import { getDb } from '../firestore'
import store from '../../../redux/store'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: jest.fn() } }))

const deletedPaths = []
const writtenDocs = []
const commentDocs = {}
// The notification docs as the LOCAL CACHE holds them - what `captureChatNotifications` reads so a
// failed archive can put the unread state back (AT-2424). A path absent here is an uncached doc; a
// path holding an Error is a failing cache read.
const notificationDocs = {}
let commitError = null

const createDb = () => {
    const batch = {
        delete: jest.fn(ref => {
            deletedPaths.push(ref.path)
        }),
        commit: jest.fn(() => (commitError ? Promise.reject(commitError) : Promise.resolve())),
        set: jest.fn((ref, data) => {
            writtenDocs.push({ path: ref.path, data })
        }),
        update: jest.fn(),
    }

    return {
        batch: jest.fn(() => batch),
        doc: jest.fn(path => ({
            path,
            get: jest.fn(async options => {
                if (options?.source !== 'cache') return { data: () => commentDocs[path] || null }

                const cached = notificationDocs[path]
                if (cached instanceof Error) throw cached
                if (cached === undefined) return { exists: false, data: () => null }
                return { exists: true, data: () => cached }
            }),
        })),
    }
}

describe('markChatCommentsAsRead', () => {
    beforeEach(() => {
        deletedPaths.length = 0
        writtenDocs.length = 0
        commitError = null
        Object.keys(commentDocs).forEach(key => delete commentDocs[key])
        Object.keys(notificationDocs).forEach(key => delete notificationDocs[key])
        getDb.mockReturnValue(createDb())
        store.getState.mockReturnValue({
            loggedUser: { uid: 'user-1' },
            projectChatNotifications: {},
        })
    })

    it('collects unique comment refs from linked emails', () => {
        expect(
            getCommentRefsFromLinkedEmails([
                { projectId: 'p1', commentId: 'c1', chatId: 'chat-1' },
                { projectId: 'p1', commentId: 'c1' },
                { commentRefs: [{ projectId: 'p2', commentId: 'c2', chatId: 'chat-2' }] },
                { messageId: 'm1' },
            ])
        ).toEqual([
            { projectId: 'p1', chatId: 'chat-1', commentId: 'c1' },
            { projectId: 'p2', chatId: 'chat-2', commentId: 'c2' },
        ])
    })

    it('reads unread comment refs from the chat notification store', () => {
        expect(
            collectUnreadCommentRefs({
                'project-1': {
                    totalFollowed: 1,
                    totalUnfollowed: 1,
                    'chat-1': {
                        followedCommentIds: ['followed-1'],
                        unfollowedCommentIds: ['email-1', ''],
                    },
                },
                'project-2': {
                    'chat-2': {
                        unfollowedCommentIds: ['email-2'],
                    },
                },
            })
        ).toEqual([
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'followed-1' },
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'email-1' },
            { projectId: 'project-2', chatId: 'chat-2', commentId: 'email-2' },
        ])
    })

    it('deletes the Alldone chat notification docs for those comments', async () => {
        await markChatCommentsAsRead([
            { projectId: 'project-1', commentId: 'comment-1' },
            { projectId: 'project-1', commentId: 'comment-1' },
            { projectId: 'project-2', commentId: 'comment-2' },
        ])

        expect(deletedPaths).toEqual([
            'chatNotifications/project-1/user-1/comment-1',
            'chatNotifications/project-2/user-1/comment-2',
        ])
    })

    it('does nothing without a logged-in user or comment ids', async () => {
        store.getState.mockReturnValue({ loggedUser: {}, projectChatNotifications: {} })
        await markChatCommentsAsRead([{ projectId: 'project-1', commentId: 'comment-1' }])
        expect(deletedPaths).toEqual([])

        store.getState.mockReturnValue({ loggedUser: { uid: 'user-1' }, projectChatNotifications: {} })
        await markChatCommentsAsRead([])
        expect(deletedPaths).toEqual([])
    })

    it('marks matching unread email comments as read by Gmail message id', async () => {
        store.getState.mockReturnValue({
            loggedUser: { uid: 'user-1' },
            projectChatNotifications: {
                'project-1': {
                    'chat-1': { unfollowedCommentIds: ['gmail-1'] },
                    'chat-2': { unfollowedCommentIds: ['gmail-2'] },
                },
            },
        })
        commentDocs['chatComments/project-1/topics/chat-1/comments/gmail-1'] = {
            gmailData: { messageId: 'message-1' },
        }
        commentDocs['chatComments/project-1/topics/chat-2/comments/gmail-2'] = {
            gmailData: { messageId: 'message-2' },
        }

        await markChatCommentsAsReadByMessageIds(['message-1'])

        expect(deletedPaths).toEqual(['chatNotifications/project-1/user-1/gmail-1'])
    })

    it('uses known comment refs and only looks up emails that lack them', async () => {
        store.getState.mockReturnValue({
            loggedUser: { uid: 'user-1' },
            projectChatNotifications: {
                'project-2': {
                    'chat-9': { unfollowedCommentIds: ['gmail-9'] },
                },
            },
        })
        commentDocs['chatComments/project-2/topics/chat-9/comments/gmail-9'] = {
            gmailData: { messageId: 'message-9' },
        }

        await markAlldoneChatsReadForLinkedEmails([
            { projectId: 'project-1', commentId: 'comment-1', messageId: 'message-1' },
            { messageId: 'message-9' },
        ])

        expect(deletedPaths).toEqual([
            'chatNotifications/project-1/user-1/comment-1',
            'chatNotifications/project-2/user-1/gmail-9',
        ])
    })
})

/**
 * AT-2424. Archiving an email comment clears its unread state on the press instead of waiting out
 * the mailbox round trips, so the delete has to be undoable: if Gmail then refuses, the comment
 * comes back unread rather than quietly staying read next to a mail still sitting in the inbox.
 */
describe('optimistic unread clearing (AT-2424)', () => {
    const notification = { chatId: 'chat-1', chatType: 'topics', followed: false, date: 1787655202430 }

    beforeEach(() => {
        deletedPaths.length = 0
        writtenDocs.length = 0
        commitError = null
        Object.keys(commentDocs).forEach(key => delete commentDocs[key])
        Object.keys(notificationDocs).forEach(key => delete notificationDocs[key])
        getDb.mockReturnValue(createDb())
        store.getState.mockReturnValue({ loggedUser: { uid: 'user-1' }, projectChatNotifications: {} })
    })

    it('captures the notification docs from the local cache, never the server', async () => {
        notificationDocs['chatNotifications/project-1/user-1/comment-1'] = notification
        const db = getDb()

        const captured = await captureChatNotifications([{ projectId: 'project-1', commentId: 'comment-1' }])

        expect(captured).toEqual([{ projectId: 'project-1', chatId: '', commentId: 'comment-1', data: notification }])
        // The collection is under a live watcher, so the cached copy is the current one - and a
        // cache read costs no round trip, no billed read, and works offline. This sits on the press.
        const ref = db.doc.mock.results[db.doc.mock.results.length - 1].value
        expect(ref.get).toHaveBeenCalledWith({ source: 'cache' })
    })

    it('skips a ref that is not cached or whose read fails, instead of inventing unread state', async () => {
        notificationDocs['chatNotifications/project-1/user-1/cached'] = notification
        notificationDocs['chatNotifications/project-1/user-1/broken'] = new Error('no cache')

        const captured = await captureChatNotifications([
            { projectId: 'project-1', commentId: 'cached' },
            { projectId: 'project-1', commentId: 'uncached' },
            { projectId: 'project-1', commentId: 'broken' },
        ])

        expect(captured.map(entry => entry.commentId)).toEqual(['cached'])
    })

    it('clears the unread state now and hands back a rollback that restores it exactly', async () => {
        notificationDocs['chatNotifications/project-1/user-1/comment-1'] = notification

        const restore = await clearChatCommentsForLinkedEmails([
            { connectionProjectId: 'conn-a', messageId: 'm1', projectId: 'project-1', commentId: 'comment-1' },
        ])

        expect(deletedPaths).toEqual(['chatNotifications/project-1/user-1/comment-1'])
        expect(writtenDocs).toEqual([])

        await restore()

        expect(writtenDocs).toEqual([{ path: 'chatNotifications/project-1/user-1/comment-1', data: notification }])
    })

    it('resolves comments that can only be matched by Gmail message id, and restores those too', async () => {
        store.getState.mockReturnValue({
            loggedUser: { uid: 'user-1' },
            projectChatNotifications: { 'project-2': { 'chat-9': { unfollowedCommentIds: ['gmail-9'] } } },
        })
        commentDocs['chatComments/project-2/topics/chat-9/comments/gmail-9'] = {
            gmailData: { messageId: 'message-9' },
        }
        notificationDocs['chatNotifications/project-2/user-1/gmail-9'] = notification

        const restore = await clearChatCommentsForLinkedEmails([
            { connectionProjectId: 'conn-a', messageId: 'message-9' },
        ])

        expect(deletedPaths).toEqual(['chatNotifications/project-2/user-1/gmail-9'])

        await restore()

        expect(writtenDocs).toEqual([{ path: 'chatNotifications/project-2/user-1/gmail-9', data: notification }])
    })

    it('restores at most once, so a retried failure path cannot resurrect a read comment', async () => {
        notificationDocs['chatNotifications/project-1/user-1/comment-1'] = notification

        const restore = await clearChatCommentsForLinkedEmails([
            { connectionProjectId: 'conn-a', messageId: 'm1', projectId: 'project-1', commentId: 'comment-1' },
        ])

        await restore()
        await restore()

        expect(writtenDocs).toHaveLength(1)
    })

    it('never throws out of the rollback, because the caller is already reporting a failure', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        notificationDocs['chatNotifications/project-1/user-1/comment-1'] = notification

        const restore = await clearChatCommentsForLinkedEmails([
            { connectionProjectId: 'conn-a', messageId: 'm1', projectId: 'project-1', commentId: 'comment-1' },
        ])
        commitError = new Error('write failed')

        await expect(restore()).resolves.toBeUndefined()
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })

    it('has nothing to restore when the docs were never in the cache', async () => {
        const restore = await clearChatCommentsForLinkedEmails([
            { connectionProjectId: 'conn-a', messageId: 'm1', projectId: 'project-1', commentId: 'comment-1' },
        ])

        expect(deletedPaths).toEqual(['chatNotifications/project-1/user-1/comment-1'])

        await restore()

        expect(writtenDocs).toEqual([])
    })

    it('does nothing at all without a logged-in user', async () => {
        store.getState.mockReturnValue({ loggedUser: {}, projectChatNotifications: {} })

        expect(await captureChatNotifications([{ projectId: 'project-1', commentId: 'comment-1' }])).toEqual([])
        await restoreChatNotifications([{ projectId: 'project-1', commentId: 'comment-1', data: notification }])

        expect(deletedPaths).toEqual([])
        expect(writtenDocs).toEqual([])
    })
})
