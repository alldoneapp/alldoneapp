/**
 * AT-3075 — "Mark as read" on Assistant-mode activity cards writes the same persisted read state
 * that opening the item writes, so the red badges and the chat bubble clear with it. The real
 * chat/feed read helpers and the activity-summary mirror run here; only Firestore is faked.
 */
import { markAnnaActivityRead } from './annaActivityReadState'
import { getAnnaActivityReadTargets, hasAnnaActivityReadTargets } from './annaActivityReadTargets'
import { getDb, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { isAppOffline } from '../../utils/backends/offlineWriteAck'
import store from '../../redux/store'

jest.mock('../../utils/backends/firestore', () => ({ getDb: jest.fn(), runHttpsCallableFunction: jest.fn() }))
jest.mock('../../redux/store', () => ({ __esModule: true, default: { getState: jest.fn() } }))
jest.mock('../../utils/backends/offlineWriteAck', () => ({
    awaitWriteAck: promise => promise,
    isAppOffline: jest.fn(() => false),
}))
jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: { firestore: { FieldValue: { delete: () => 'DELETE_FIELD' } } },
    firestore: { FieldValue: { delete: () => 'DELETE_FIELD' } },
}))

const chatNotice = (projectId, chatId, commentId) => ({ id: `chat/${projectId}/${chatId}/${commentId}`, kind: 'chat' })
const feedNotice = (projectId, type, objectId, feedId) => ({
    id: `feed/${projectId}/${type}/${objectId}/${feedId}`,
    kind: 'feed',
})

// The user's unread chat notifications, per project; the fake answers the chatId query from it.
let unreadChatDocs
const createDb = () => {
    const writes = []
    const commits = []
    const db = {
        doc: jest.fn(path => ({ path })),
        collection: jest.fn(path => {
            const filters = []
            const query = {
                where: (field, operator, value) => {
                    filters.push([field, value])
                    return query
                },
                get: async () => ({
                    docs: (unreadChatDocs[path] || [])
                        .filter(doc => filters.every(([field, value]) => doc.data[field] === value))
                        .map(doc => ({ ref: { path: `${path}/${doc.id}` }, data: () => doc.data })),
                }),
            }
            return query
        }),
        batch: jest.fn(() => {
            const operations = []
            return {
                set: (ref, data, options) => operations.push({ op: 'set', path: ref.path, data, options }),
                delete: ref => operations.push({ op: 'delete', path: ref.path }),
                update: (ref, data) => operations.push({ op: 'update', path: ref.path, data }),
                commit: jest.fn(async () => {
                    commits.push(operations)
                    writes.push(...operations)
                }),
            }
        }),
    }
    return { db, writes, commits }
}

let fake
beforeEach(() => {
    jest.clearAllMocks()
    store.getState.mockReturnValue({ loggedUser: { uid: 'u1' }, connectionState: 'online' })
    isAppOffline.mockReturnValue(false)
    runHttpsCallableFunction.mockResolvedValue({ cleared: true })
    unreadChatDocs = {
        'chatNotifications/p1/u1': [
            { id: 'm1', data: { chatId: 'chatA' } },
            { id: 'm2', data: { chatId: 'chatA' } },
            { id: 'm9', data: { chatId: 'otherChat' } },
        ],
        'chatNotifications/p2/u1': [{ id: 'm3', data: { chatId: 'chatB' } }],
    }
    fake = createDb()
    getDb.mockReturnValue(fake.db)
})

describe('read targets (AT-3075)', () => {
    it('reduces notices to one chat per thread and one object per feed entry', () => {
        expect(
            getAnnaActivityReadTargets([
                chatNotice('p1', 'chatA', 'm1'),
                chatNotice('p1', 'chatA', 'm2'),
                feedNotice('p1', 'tasks', 'task1', 'f1'),
                feedNotice('p1', 'tasks', 'task1', 'f2'),
                feedNotice('p2', 'notes', 'note1', 'f3'),
            ])
        ).toEqual({
            chats: [{ projectId: 'p1', chatId: 'chatA' }],
            feeds: [
                { projectId: 'p1', objectType: 'tasks', objectId: 'task1' },
                { projectId: 'p2', objectType: 'notes', objectId: 'note1' },
            ],
        })
    })

    it('ignores project-switch notices and ids that are not plain document ids', () => {
        const notices = [
            { id: 'switch-1', projectId: 'p1' },
            { id: 'chat/p1/../x/m1', kind: 'chat' },
            { id: 'chat/p 1/chatA/m1', kind: 'chat' },
            { id: 'feed/p1/tasks/task1', kind: 'feed' },
            { id: 'chat/p1/chatA/m1', kind: 'feed' },
            null,
        ]
        expect(getAnnaActivityReadTargets(notices)).toEqual({ chats: [], feeds: [] })
        expect(hasAnnaActivityReadTargets(notices)).toBe(false)
        expect(hasAnnaActivityReadTargets([chatNotice('p1', 'chatA', 'm1')])).toBe(true)
    })
})

describe('markAnnaActivityRead (AT-3075)', () => {
    it('clears a chat card exactly as opening the chat does: notifications, badge summary and server cleanup', async () => {
        await markAnnaActivityRead([chatNotice('p1', 'chatA', 'm1')])

        // Every unread message of that chat, not only the one on the card; other chats stay unread.
        const deletes = fake.writes.filter(write => write.op === 'delete').map(write => write.path)
        expect(deletes).toEqual(['chatNotifications/p1/u1/m1', 'chatNotifications/p1/u1/m2'])
        // The red badges read the activity summary; it is cleared in the same batch (counter sync).
        const summary = fake.writes.filter(write => write.path === 'users/u1/private/activityUnreadSummary')
        expect(summary.map(write => write.data)).toEqual([
            { chats: { p1: { m1: 'DELETE_FIELD' } } },
            { chats: { p1: { m2: 'DELETE_FIELD' } } },
        ])
        expect(fake.commits).toHaveLength(1)
        expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('markChatNotificationsReadSecondGen', {
            projectId: 'p1',
            chatId: 'chatA',
        })
    })

    it("clears a feed card's object in both Updates tabs and in the badge summary, in one batch", async () => {
        await markAnnaActivityRead([feedNotice('p1', 'tasks', 'task1', 'f1'), feedNotice('p1', 'tasks', 'task1', 'f2')])

        expect(fake.commits).toHaveLength(1)
        expect(fake.writes).toEqual([
            {
                op: 'set',
                path: 'feedsCount/p1/u1/followed',
                data: { tasks: { task1: 'DELETE_FIELD' } },
                options: { merge: true },
            },
            {
                op: 'set',
                path: 'feedsCount/p1/u1/all',
                data: { tasks: { task1: 'DELETE_FIELD' } },
                options: { merge: true },
            },
            {
                op: 'set',
                path: 'users/u1/private/activityUnreadSummary',
                data: {
                    feeds: {
                        p1: {
                            followed: { tasks: { task1: 'DELETE_FIELD' } },
                            all: { tasks: { task1: 'DELETE_FIELD' } },
                        },
                    },
                },
                options: { merge: true },
            },
        ])
        expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    })

    it('marks every card of a "mark all" across projects and kinds', async () => {
        await markAnnaActivityRead([
            chatNotice('p1', 'chatA', 'm1'),
            chatNotice('p2', 'chatB', 'm3'),
            feedNotice('p2', 'notes', 'note1', 'f3'),
        ])
        expect(runHttpsCallableFunction.mock.calls.map(([, data]) => data)).toEqual([
            { projectId: 'p1', chatId: 'chatA' },
            { projectId: 'p2', chatId: 'chatB' },
        ])
        const deletes = fake.writes.filter(write => write.op === 'delete').map(write => write.path)
        expect(deletes.sort()).toEqual([
            'chatNotifications/p1/u1/m1',
            'chatNotifications/p1/u1/m2',
            'chatNotifications/p2/u1/m3',
        ])
        expect(fake.writes.some(write => write.path === 'feedsCount/p2/u1/followed')).toBe(true)
    })

    it('still clears the other targets when one fails, and then reports the failure', async () => {
        runHttpsCallableFunction.mockImplementation(async (name, { chatId }) => {
            if (chatId === 'chatA') throw new Error('server down')
            return { cleared: true }
        })
        await expect(
            markAnnaActivityRead([chatNotice('p1', 'chatA', 'm1'), feedNotice('p2', 'notes', 'note1', 'f3')])
        ).rejects.toThrow('server down')
        expect(fake.writes.some(write => write.path === 'feedsCount/p2/u1/followed')).toBe(true)
    })

    it('fails fast offline with code "offline" and writes nothing', async () => {
        isAppOffline.mockReturnValue(true)
        await expect(markAnnaActivityRead([chatNotice('p1', 'chatA', 'm1')])).rejects.toMatchObject({
            code: 'offline',
        })
        expect(fake.writes).toEqual([])
        expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    })

    it('does nothing without a signed-in user or without a target', async () => {
        await markAnnaActivityRead([{ id: 'switch-1' }])
        store.getState.mockReturnValue({ loggedUser: null })
        await markAnnaActivityRead([chatNotice('p1', 'chatA', 'm1')])
        expect(fake.writes).toEqual([])
        expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    })
})
