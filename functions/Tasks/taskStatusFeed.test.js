jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))

const mockCommit = jest.fn(() => Promise.resolve())
const mockSetProjectContext = jest.fn()
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn(() => ({ commit: mockCommit, setProjectContext: mockSetProjectContext })),
}))

const mockCreateTaskUpdatedFeed = jest.fn(() => Promise.resolve())
jest.mock('../Feeds/tasksFeeds', () => ({ createTaskUpdatedFeed: mockCreateTaskUpdatedFeed }))

const mockLoadFeedsGlobalState = jest.fn()
jest.mock('../GlobalState/globalState', () => ({ loadFeedsGlobalState: mockLoadFeedsGlobalState }))

const { buildTaskStatusFeedDescriptor, normalizeTaskForFeeds, persistTaskStatusFeed } = require('./taskStatusFeed')

describe('server-owned task status feeds', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('builds deterministic Done and Open activity descriptors', () => {
        expect(buildTaskStatusFeedDescriptor('task-1', { done: false }, { done: true, lastEditionDate: 123 })).toEqual({
            done: true,
            feedId: 'task-status-123-done',
            feedType: 23,
            entryText: 'checked task as Done',
            taskId: 'task-1',
        })
        expect(
            buildTaskStatusFeedDescriptor(
                'task-1',
                { done: true },
                { done: false, parentId: 'parent-1', lastEditionDate: 124 }
            )
        ).toEqual(
            expect.objectContaining({
                done: false,
                feedId: 'task-status-124-open',
                feedType: 231,
                entryText: 'changed subtask to Open',
            })
        )
        expect(buildTaskStatusFeedDescriptor('task-1', { done: false }, { done: false })).toBeNull()
    })

    test('normalizes both legacy Open estimation keys', () => {
        expect(normalizeTaskForFeeds({ estimations: { Open: 2 } }).estimations).toEqual({ Open: 2, '-1': 2 })
    })

    test('persists the transition through the trusted feed pipeline', async () => {
        const database = {
            doc: jest.fn(path => ({
                get: jest.fn(() =>
                    Promise.resolve({
                        exists: true,
                        data: () =>
                            path.startsWith('projects/')
                                ? { userIds: ['user-1', 'user-2'] }
                                : { displayName: 'Karsten', photoURL: 'photo.png' },
                    })
                ),
            })),
        }

        await expect(
            persistTaskStatusFeed({
                projectId: 'project-1',
                taskId: 'task-1',
                oldTask: { done: false },
                newTask: {
                    done: true,
                    lastEditionDate: 123,
                    lastEditorId: 'user-1',
                    estimations: { Open: 1 },
                },
                database,
            })
        ).resolves.toBe(true)

        expect(mockSetProjectContext).toHaveBeenCalledWith('project-1')
        expect(mockCreateTaskUpdatedFeed).toHaveBeenCalledWith(
            'project-1',
            expect.objectContaining({ estimations: { Open: 1, '-1': 1 } }),
            'task-1',
            expect.any(Object),
            expect.objectContaining({ uid: 'user-1', displayName: 'Karsten' }),
            true,
            expect.objectContaining({
                feedId: 'task-status-123-done',
                feedType: 23,
                entryText: 'checked task as Done',
                isDone: true,
            })
        )
        expect(mockCommit).toHaveBeenCalledTimes(1)
    })
})
