const mockBatchSet = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()
const mockCreateProjectDescriptionChangedFeed = jest.fn()
const mockGetFeedUserData = jest.fn()

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: mockBatchUpdate,
        set: mockBatchSet,
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
            completionWrite: {
                ref: { path: 'assistantThreadState/workflow' },
                data: { projectWorkflow: { completedIds: ['project-1'] } },
            },
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
        expect(mockBatchSet).toHaveBeenCalledWith(
            { path: 'assistantThreadState/workflow' },
            { projectWorkflow: { completedIds: ['project-1'] } },
            { merge: true }
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
    describe('expectedDescription (automatic update, AT-3095)', () => {
        const dbWith = description => ({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({
                        exists: true,
                        data: () => ({ name: 'Operations', description, userIds: ['user-1'] }),
                    }),
                })),
            })),
            doc: jest.fn(path => ({ path })),
        })

        test('writes nothing when the description changed since it was read', async () => {
            const result = await updateProjectDescription({
                db: dbWith('A member wrote this meanwhile'),
                projectId: 'project-1',
                userId: 'user-1',
                description: 'Model text',
                feedUser: { uid: 'assistant-1' },
                expectedDescription: 'What the run read',
            })

            expect(result).toMatchObject({ success: false, updated: false, conflict: true })
            expect(mockBatchUpdate).not.toHaveBeenCalled()
            expect(mockCreateProjectDescriptionChangedFeed).not.toHaveBeenCalled()
            expect(mockBatchCommit).not.toHaveBeenCalled()
        })

        test('writes and posts the feed line as the given actor when it still matches', async () => {
            const result = await updateProjectDescription({
                db: dbWith('What the run read '),
                projectId: 'project-1',
                userId: 'user-1',
                description: 'Model text',
                feedUser: { uid: 'assistant-1' },
                expectedDescription: 'What the run read',
            })

            expect(result).toMatchObject({ success: true, updated: true })
            expect(mockBatchUpdate).toHaveBeenCalledWith({ path: 'projects/project-1' }, { description: 'Model text' })
            expect(mockCreateProjectDescriptionChangedFeed.mock.calls[0][5]).toEqual({ uid: 'assistant-1' })
            expect(mockGetFeedUserData).not.toHaveBeenCalled()
        })
    })
})
