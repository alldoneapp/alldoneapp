const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockCreateProjectDescriptionChangedFeed = jest.fn()
const mockGetFeedUserData = jest.fn()

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: mockBatchUpdate,
        commit: mockBatchCommit,
    })),
}))

jest.mock('../Feeds/projectsFeeds', () => ({
    createProjectDescriptionChangedFeed: (...args) => mockCreateProjectDescriptionChangedFeed(...args),
}))

jest.mock('./UserHelper', () => ({
    UserHelper: {
        getFeedUserData: (...args) => mockGetFeedUserData(...args),
    },
}))

const { updateProjectDescription } = require('./projectDescriptionUpdateHelper')

describe('projectDescriptionUpdateHelper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockBatchCommit.mockResolvedValue(undefined)
        mockCreateProjectDescriptionChangedFeed.mockResolvedValue(undefined)
        mockGetFeedUserData.mockResolvedValue({ uid: 'user-1', name: 'User 1' })
    })

    test('updates project description and emits feed side effects', async () => {
        const db = {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({
                            name: 'Operations',
                            description: 'Old description',
                            color: '#fff',
                            userIds: ['user-1'],
                        }),
                    }),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        }

        const result = await updateProjectDescription({
            db,
            projectId: 'project-1',
            userId: 'user-1',
            description: '  New description  ',
        })

        expect(mockBatchUpdate).toHaveBeenCalledWith({ path: 'projects/project-1' }, { description: 'New description' })
        expect(mockCreateProjectDescriptionChangedFeed).toHaveBeenCalledWith(
            'project-1',
            expect.objectContaining({
                name: 'Operations',
                description: 'New description',
            }),
            'New description',
            'Old description',
            expect.any(Object),
            { uid: 'user-1', name: 'User 1' },
            false
        )
        expect(mockBatchCommit).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
            success: true,
            updated: true,
            project: { id: 'project-1', name: 'Operations' },
            description: 'New description',
            previousDescription: 'Old description',
        })
    })

    test('returns a no-op when the normalized description has not changed', async () => {
        const db = {
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({
                            name: 'Operations',
                            description: 'Current description',
                        }),
                    }),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        }

        const result = await updateProjectDescription({
            db,
            projectId: 'project-1',
            userId: 'user-1',
            description: '  Current description  ',
        })

        expect(result.updated).toBe(false)
        expect(mockBatchUpdate).not.toHaveBeenCalled()
        expect(mockCreateProjectDescriptionChangedFeed).not.toHaveBeenCalled()
        expect(mockBatchCommit).not.toHaveBeenCalled()
    })
})
