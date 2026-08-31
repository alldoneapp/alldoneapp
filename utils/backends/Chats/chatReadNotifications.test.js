import { markChatMessagesAsRead, markMessagesAsRead } from './chatReadNotifications'
import { getDb, runHttpsCallableFunction } from '../firestore'
import store from '../../../redux/store'

jest.mock('../firestore', () => ({ getDb: jest.fn(), runHttpsCallableFunction: jest.fn() }))
jest.mock('../../../redux/store', () => ({ __esModule: true, default: { getState: jest.fn() } }))
jest.mock('../offlineWriteAck', () => ({ awaitWriteAck: promise => promise }))

const snapshot = (path, data) => ({
    id: path.split('/').pop(),
    path,
    ref: { path },
    data: () => data,
})

const createDb = customResults => {
    const queries = []
    const writes = []
    const results = customResults || {
        'chatNotifications/project-1/user-1': [
            snapshot('chatNotifications/project-1/user-1/comment-1', { chatId: 'chat-1' }),
        ],
    }

    const db = {
        collection: jest.fn(path => {
            const filters = []
            const query = {
                where: jest.fn((field, operator, value) => {
                    filters.push([field, operator, value])
                    return query
                }),
                get: jest.fn(async () => {
                    queries.push({ path, filters })
                    const docs = (results[path] || []).filter(document =>
                        filters.every(
                            ([field, operator, value]) => operator === '==' && document.data()?.[field] === value
                        )
                    )
                    return { docs }
                }),
            }
            return query
        }),
        batch: jest.fn(() => ({
            delete: ref => writes.push({ operation: 'delete', path: ref.path }),
            set: (ref, data, options) => writes.push({ operation: 'set', path: ref.path, data, options }),
            update: jest.fn(),
            commit: jest.fn(async () => undefined),
        })),
    }

    return { db, queries, writes }
}

describe('markChatMessagesAsRead', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        store.getState.mockReturnValue({ loggedUser: { uid: 'user-1' } })
        runHttpsCallableFunction.mockResolvedValue({ cleared: true })
    })

    it('clears the user-owned inbox locally and delegates side-channel cleanup to the server', async () => {
        const { db, queries, writes } = createDb()
        getDb.mockReturnValue(db)

        await markChatMessagesAsRead('project-1', 'chat-1')

        expect(queries).toEqual([
            {
                path: 'chatNotifications/project-1/user-1',
                filters: [['chatId', '==', 'chat-1']],
            },
        ])
        expect(writes).toEqual([
            {
                operation: 'delete',
                path: 'chatNotifications/project-1/user-1/comment-1',
            },
        ])
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('markChatNotificationsReadSecondGen', {
            projectId: 'project-1',
            chatId: 'chat-1',
        })
    })

    it('does nothing without a signed-in user', async () => {
        store.getState.mockReturnValue({ loggedUser: {} })

        await markChatMessagesAsRead('project-1', 'chat-1')

        expect(getDb).not.toHaveBeenCalled()
        expect(runHttpsCallableFunction).not.toHaveBeenCalled()
    })

    it('bulk-clears only followed notifications for the authenticated user', async () => {
        const { db, queries, writes } = createDb({
            'chatNotifications/project-1/user-1': [
                snapshot('chatNotifications/project-1/user-1/comment-1', { followed: true }),
                snapshot('chatNotifications/project-1/user-1/comment-2', { followed: false }),
            ],
        })
        getDb.mockReturnValue(db)
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

        await markMessagesAsRead('project-1', 'stale-user', 0)

        expect(queries).toEqual([
            {
                path: 'chatNotifications/project-1/user-1',
                filters: [['followed', '==', true]],
            },
        ])
        expect(writes).toEqual([{ operation: 'delete', path: 'chatNotifications/project-1/user-1/comment-1' }])
        expect(runHttpsCallableFunction).toHaveBeenCalledWith('markChatNotificationsReadSecondGen', {
            projectId: 'project-1',
            followedOnly: true,
        })
        expect(consoleSpy).toHaveBeenCalledWith('[chat read] Ignoring a stale unread owner id', {
            projectId: 'project-1',
            requestedUserId: 'stale-user',
        })
        consoleSpy.mockRestore()
    })
})
