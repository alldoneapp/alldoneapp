const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockCreateUserDescriptionChangedFeed = jest.fn()
const mockCreateUserGlobalDescriptionChangedFeed = jest.fn()
const mockGetFeedUserData = jest.fn()

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: mockBatchUpdate,
        commit: mockBatchCommit,
    })),
}))

jest.mock('../Feeds/usersFeeds', () => ({
    createUserDescriptionChangedFeed: (...args) => mockCreateUserDescriptionChangedFeed(...args),
    createUserGlobalDescriptionChangedFeed: (...args) => mockCreateUserGlobalDescriptionChangedFeed(...args),
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

    test('updates only the global user description by default', async () => {
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
        expect(mockBatchUpdate).toHaveBeenCalledTimes(1)
        expect(mockCreateUserDescriptionChangedFeed).not.toHaveBeenCalled()
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
            success: true,
            updated: true,
            scope: 'global',
            user: { id: 'user-1', name: 'Anna Alldone' },
            description: 'New weekly update',
            previousDescription: 'Global description',
        })
    })

    test('returns no update when the global user description already matches', async () => {
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
        expect(mockCreateUserGlobalDescriptionChangedFeed).not.toHaveBeenCalled()
    })

    // MCP feed parity: contacts and moves
    describe('the global description writes an entry on the user in their default project', () => {
        const mcpActor = { uid: 'user-1', displayName: 'Anna Alldone', via: 'mcp', viaClient: 'Claude' }
        const globalDb = ({ defaultProjectId = 'project-home', memberIds = ['user-1'] } = {}) => ({
            collection: jest.fn(collectionName => ({
                doc: jest.fn(docId => ({
                    get: jest.fn().mockResolvedValue(
                        collectionName === 'users'
                            ? {
                                  exists: true,
                                  data: () => ({
                                      displayName: 'Anna Alldone',
                                      extendedDescription: 'Global description',
                                      defaultProjectId,
                                  }),
                              }
                            : { exists: docId === 'project-home', data: () => ({ userIds: memberIds }) }
                    ),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        })

        test('with the actor, after the description is saved', async () => {
            const result = await updateUserDescription({
                db: globalDb(),
                targetUserId: 'user-1',
                actorUserId: 'user-1',
                description: 'New weekly update',
                feedUser: mcpActor,
            })

            expect(result).toMatchObject({ updated: true, scope: 'global' })
            expect(mockCreateUserGlobalDescriptionChangedFeed).toHaveBeenCalledWith(
                'project-home',
                'user-1',
                'New weekly update',
                'Global description',
                expect.any(Object),
                mcpActor,
                false
            )
            expect(mockCreateUserDescriptionChangedFeed).not.toHaveBeenCalled()
            expect(mockBatchCommit).toHaveBeenCalledTimes(2)
        })

        test('not without a default project, nor in one the user left', async () => {
            await updateUserDescription({
                db: globalDb({ defaultProjectId: '' }),
                targetUserId: 'user-1',
                actorUserId: 'user-1',
                description: 'New weekly update',
                feedUser: mcpActor,
            })
            await updateUserDescription({
                db: globalDb({ memberIds: ['someone-else'] }),
                targetUserId: 'user-1',
                actorUserId: 'user-1',
                description: 'New weekly update',
                feedUser: mcpActor,
            })

            expect(mockCreateUserGlobalDescriptionChangedFeed).not.toHaveBeenCalled()
        })

        test('a failing entry is logged and the update still succeeds', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
            mockCreateUserGlobalDescriptionChangedFeed.mockRejectedValueOnce(new Error('feed store down'))

            const result = await updateUserDescription({
                db: globalDb(),
                targetUserId: 'user-1',
                actorUserId: 'user-1',
                description: 'New weekly update',
                feedUser: mcpActor,
            })

            expect(result).toMatchObject({ success: true, updated: true, scope: 'global' })
            expect(warn).toHaveBeenCalledWith(
                '[userDescriptionUpdateHelper] Could not write the global description feed',
                expect.objectContaining({ error: 'feed store down' })
            )
            warn.mockRestore()
        })
    })
})
