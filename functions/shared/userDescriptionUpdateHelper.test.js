const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockCreateUserDescriptionChangedFeed = jest.fn()
const mockGetFeedUserData = jest.fn()
const mockProjectServiceGetUserProjects = jest.fn()

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

jest.mock('./ProjectService', () => ({
    ProjectService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        getUserProjects: (...args) => mockProjectServiceGetUserProjects(...args),
    })),
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
        mockProjectServiceGetUserProjects.mockResolvedValue([])
    })

    test('updates user description globally and syncs accessible projects', async () => {
        const db = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(docId => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'users'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      displayName: 'Anna Alldone',
                                      description: 'Global description',
                                  }),
                              }
                            : {
                                  exists: true,
                                  data: () => ({
                                      name: docId === 'project-1' ? 'Operations' : 'Marketing',
                                      userIds: ['user-1'],
                                      usersData: {
                                          'user-1': {
                                              description: docId === 'project-1' ? 'Old description' : '',
                                              extendedDescription: docId === 'project-1' ? 'Old description' : '',
                                          },
                                      },
                                  }),
                              }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        }
        mockProjectServiceGetUserProjects.mockResolvedValue([
            { id: 'project-1', name: 'Operations' },
            { id: 'project-2', name: 'Marketing' },
        ])

        const result = await updateUserDescription({
            db,
            targetUserId: 'user-1',
            actorUserId: 'user-1',
            description: '  New weekly update  ',
        })

        expect(mockBatchUpdate).toHaveBeenCalledWith(
            { path: 'users/user-1' },
            {
                description: 'New weekly update',
                extendedDescription: 'New weekly update',
            }
        )
        expect(mockBatchUpdate).toHaveBeenCalledWith(
            { path: 'projects/project-1' },
            {
                'usersData.user-1.description': 'New weekly update',
                'usersData.user-1.extendedDescription': 'New weekly update',
            }
        )
        expect(mockBatchUpdate).toHaveBeenCalledWith(
            { path: 'projects/project-2' },
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
        expect(mockCreateUserDescriptionChangedFeed).toHaveBeenCalledWith(
            'project-2',
            'user-1',
            'New weekly update',
            '',
            expect.any(Object),
            { uid: 'user-1', name: 'User 1' },
            false
        )
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
            success: true,
            updated: true,
            scope: 'global',
            user: { id: 'user-1', name: 'Anna Alldone' },
            description: 'New weekly update',
            previousDescription: 'Global description',
            projectsUpdated: [
                { id: 'project-1', name: 'Operations' },
                { id: 'project-2', name: 'Marketing' },
            ],
        })
    })

    test('returns no update when global and synced project descriptions already match', async () => {
        const db = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(docId => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'users'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      displayName: 'Anna Alldone',
                                      extendedDescription: 'Current global user update',
                                  }),
                              }
                            : {
                                  exists: true,
                                  data: () => ({
                                      name: docId === 'project-1' ? 'Operations' : 'Marketing',
                                      userIds: ['user-1'],
                                      usersData: {
                                          'user-1': {
                                              extendedDescription: 'Current global user update',
                                          },
                                      },
                                  }),
                              }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        }
        mockProjectServiceGetUserProjects.mockResolvedValue([
            { id: 'project-1', name: 'Operations' },
            { id: 'project-2', name: 'Marketing' },
        ])

        const result = await updateUserDescription({
            db,
            targetUserId: 'user-1',
            actorUserId: 'user-1',
            description: '  Current global user update  ',
        })

        expect(result.updated).toBe(false)
        expect(mockBatchUpdate).not.toHaveBeenCalled()
        expect(mockCreateUserDescriptionChangedFeed).not.toHaveBeenCalled()
        expect(mockBatchCommit).not.toHaveBeenCalled()
    })

    test('updates only the targeted project when projectId is provided', async () => {
        const db = {
            collection: jest.fn(collectionName => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'users'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      displayName: 'Anna Alldone',
                                      extendedDescription: 'Global description',
                                  }),
                              }
                            : {
                                  exists: true,
                                  data: () => ({
                                      name: 'Operations',
                                      userIds: ['user-1'],
                                      usersData: {
                                          'user-1': {
                                              extendedDescription: 'Old description',
                                          },
                                      },
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
            description: 'Project-specific update',
        })

        expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
        expect(mockBatchUpdate).toHaveBeenCalledWith(
            { path: 'projects/project-1' },
            {
                'usersData.user-1.description': 'Project-specific update',
                'usersData.user-1.extendedDescription': 'Project-specific update',
            }
        )
        expect(result).toMatchObject({
            success: true,
            updated: true,
            scope: 'project',
            project: { id: 'project-1', name: 'Operations' },
            description: 'Project-specific update',
            previousDescription: 'Old description',
        })
    })
})
