const mockSet = jest.fn(async () => {})
const mockUpdate = jest.fn(async () => {})

const mockTaskData = {
    id: 'task-1',
    name: 'Review proposal',
    extendedName: 'Review proposal',
    userId: 'user-1',
    creatorId: 'assistant-1',
    created: 123,
    isPublicFor: [0, 'user-1'],
    commentsData: { amount: 1 },
}

const mockRefs = new Map()
const mockGetRef = path => {
    if (!mockRefs.has(path)) {
        mockRefs.set(path, {
            path,
            get: jest.fn(async () => {
                if (path === 'items/project-1/tasks/task-1') {
                    return { exists: true, data: () => mockTaskData }
                }
                if (path === 'chatObjects/project-1/chats/task-1') {
                    return { exists: true, data: () => ({ commentsData: { amount: 1 } }) }
                }
                return { exists: false, data: () => null }
            }),
            set: mockSet,
            update: mockUpdate,
        })
    }
    return mockRefs.get(path)
}

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => ({ doc: mockGetRef })),
        {
            Timestamp: { now: jest.fn(() => 'timestamp') },
            FieldValue: { arrayUnion: jest.fn((...values) => ({ arrayUnion: values })) },
        }
    ),
}))

jest.mock('../Firestore/generalFirestoreCloud', () => ({ getId: jest.fn(() => 'comment-1') }))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ STAYWARD_COMMENT: 'STAYWARD_COMMENT' }))

const { addAssistantTaskComment } = require('./assistantTaskCommentHelper')

describe('addAssistantTaskComment', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('writes a visible assistant comment and updates task/chat previews', async () => {
        await expect(
            addAssistantTaskComment({
                projectId: 'project-1',
                taskId: 'task-1',
                assistantId: 'assistant-1',
                comment: '  This proposal needs a response by Friday.  ',
            })
        ).resolves.toEqual({
            commentId: 'comment-1',
            commentText: 'This proposal needs a response by Friday.',
        })

        expect(mockGetRef('chatComments/project-1/tasks/task-1/comments/comment-1').set).toHaveBeenCalledWith(
            expect.objectContaining({
                creatorId: 'assistant-1',
                commentText: 'This proposal needs a response by Friday.',
                originalContent: 'This proposal needs a response by Friday.',
                fromAssistant: true,
            })
        )
        expect(mockGetRef('items/project-1/tasks/task-1').update).toHaveBeenCalledWith({
            commentsData: expect.objectContaining({ amount: 2, lastCommentOwnerId: 'assistant-1' }),
        })
        expect(mockGetRef('chatObjects/project-1/chats/task-1').update).toHaveBeenCalledWith(
            expect.objectContaining({
                commentsData: expect.objectContaining({ amount: 2, lastCommentOwnerId: 'assistant-1' }),
            })
        )
    })
})
