const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockCreateUserDescriptionChangedFeed = jest.fn()
const mockGetFeedUserData = jest.fn()

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: mockBatchUpdate,
        commit: mockBatchCommit,
    })),
}))

jest.mock('../Feeds/usersFeeds', () => ({
    createUserDescriptionChangedFeed: (...args) => mockCreateUserDescriptionChangedFeed(...args),
}))

jest.mock('./UserHelper', () => ({
    UserHelper: {
        getFeedUserData: (...args) => mockGetFeedUserData(...args),
    },
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    getTaskNameWithoutMeta: jest.fn(value =>
        String(value || '')
            .replace(/@\S+/g, '')
            .trim()
    ),
}))

const { updateUserDescription } = require('./userDescriptionUpdateHelper')

describe('userDescriptionUpdateHelper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockBatchCommit.mockResolvedValue(undefined)
        mockCreateUserDescriptionChangedFeed.mockResolvedValue(undefined)
        mockGetFeedUserData.mockResolvedValue({ uid: 'user-1', name: 'User 1' })
    })

    test('updates user description in project and emits feed side effects', async () => {
        const db = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(docId => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'projects'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      name: 'Operations',
                                      userIds: ['user-1'],
                                      usersData: {
                                          'user-1': {
                                              description: 'Old description',
                                              extendedDescription: 'Old description',
                                          },
                                      },
                                  }),
                              }
                            : {
                                  exists: true,
                                  data: () => ({
                                      displayName: 'Anna Alldone',
                                      description: 'Global description',
                                  }),
                              }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        }

        const result = await updateUserDescription({
            db,
            projectId: 'project-1',
            targetUserId: 'user-1',
            actorUserId: 'user-1',
            description: '  New weekly update  ',
        })

        expect(mockBatchUpdate).toHaveBeenCalledWith(
            { path: 'projects/project-1' },
            {
                'usersData.user-1.description': 'New weekly update',
                'usersData.user-1.extendedDescription': 'New weekly update',
            }
        )
        expect(mockCreateUserDescriptionChangedFeed).toHaveBeenCalledWith(
            'project-1',
            'user-1',
            'New weekly update',
            'Old description',
            expect.any(Object),
            { uid: 'user-1', name: 'User 1' },
            false
        )
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
            success: true,
            updated: true,
            user: { id: 'user-1', name: 'Anna Alldone' },
            project: { id: 'project-1', name: 'Operations' },
            description: 'New weekly update',
            previousDescription: 'Old description',
        })
    })

    test('falls back to the global user description when the project-specific one is empty', async () => {
        const db = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'projects'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      name: 'Operations',
                                      userIds: ['user-1'],
                                      usersData: { 'user-1': {} },
                                  }),
                              }
                            : {
                                  exists: true,
                                  data: () => ({
                                      displayName: 'Anna Alldone',
                                      extendedDescription: 'Current global user update',
                                  }),
                              }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        }

        const result = await updateUserDescription({
            db,
            projectId: 'project-1',
            targetUserId: 'user-1',
            actorUserId: 'user-1',
            description: '  Current global user update  ',
        })

        expect(result.updated).toBe(false)
        expect(mockBatchUpdate).not.toHaveBeenCalled()
        expect(mockCreateUserDescriptionChangedFeed).not.toHaveBeenCalled()
        expect(mockBatchCommit).not.toHaveBeenCalled()
    })
})
