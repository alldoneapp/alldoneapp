jest.mock('firebase-admin', () => {
    const refs = new Map()
    const getAll = jest.fn(() => Promise.resolve([{ exists: true }, { exists: false }]))
    const doc = jest.fn(path => {
        if (!refs.has(path)) {
            refs.set(path, {
                path,
                get: jest.fn(() => Promise.resolve({ exists: false, data: () => ({}) })),
                set: jest.fn(() => Promise.resolve()),
                update: jest.fn(() => Promise.resolve()),
            })
        }
        return refs.get(path)
    })
    const collection = jest.fn(path => ({
        path,
        limit: jest.fn(() => ({
            get: jest.fn(() => Promise.resolve({ empty: true, docs: [] })),
        })),
    }))

    return {
        firestore: Object.assign(
            jest.fn(() => ({
                doc,
                collection,
                getAll,
            })),
            {
                FieldValue: {
                    arrayUnion: jest.fn((...items) => ({ type: 'arrayUnion', items })),
                },
                Timestamp: {
                    now: jest.fn(() => 'timestamp-now'),
                },
            }
        ),
        __mock: {
            refs,
            doc,
            collection,
            getAll,
            reset: () => {
                refs.clear()
                doc.mockClear()
                collection.mockClear()
                getAll.mockClear()
                getAll.mockResolvedValue([{ exists: true }, { exists: false }])
            },
        },
    }
})

jest.mock('../Firestore/generalFirestoreCloud', () => ({
    getId: jest.fn(() => 'comment-1'),
}))

jest.mock('../Firestore/assistantsFirestore', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    getDefaultAssistantData: jest.fn(() => Promise.resolve({ uid: 'global-assistant' })),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    STAYWARD_COMMENT: 2,
}))

const admin = require('firebase-admin')
const assistantsFirestore = require('../Firestore/assistantsFirestore')
const { addProjectRoutingReasonComment, buildProjectRoutingReasonComment } = require('./projectRoutingCommentHelper')

describe('projectRoutingCommentHelper', () => {
    beforeEach(() => {
        admin.__mock.reset()
        assistantsFirestore.getDefaultAssistantData.mockResolvedValue({ uid: 'global-assistant' })
    })

    test('builds concise routing comments with confidence', () => {
        expect(
            buildProjectRoutingReasonComment({
                projectName: 'Product',
                reasoning: 'the event mentions the roadmap',
                confidence: 0.824,
            })
        ).toBe('I chose Product because the event mentions the roadmap. Confidence: 82%.')
    })

    test('writes comment, task metadata, and creates chat metadata', async () => {
        admin.__mock.doc.mockImplementation(path => {
            const ref = {
                path,
                get: jest.fn(() => Promise.resolve({ exists: false, data: () => ({}) })),
                set: jest.fn(() => Promise.resolve()),
                update: jest.fn(() => Promise.resolve()),
            }

            if (path === 'projects/default-project') {
                ref.get = jest.fn(() => Promise.resolve({ exists: true, data: () => ({ assistantId: 'assistant-1' }) }))
            }

            admin.__mock.refs.set(path, ref)
            return ref
        })

        const result = await addProjectRoutingReasonComment({
            userData: { defaultProjectId: 'default-project' },
            projectId: 'target-project',
            taskId: 'task-1',
            task: {
                id: 'task-1',
                name: 'Roadmap meeting',
                userId: 'user-1',
                creatorId: 'user-1',
                isPublicFor: [0, 'user-1'],
                commentsData: null,
            },
            projectName: 'Product',
            reasoning: 'the event mentions the roadmap',
            confidence: 0.82,
            source: 'calendar_project_routing',
            routingKey: 'event-1',
            sourceDataField: 'calendarData',
        })

        expect(result.commentId).toBe('comment-1')
        expect(
            admin.__mock.refs.get('chatComments/target-project/tasks/task-1/comments/comment-1').set
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                creatorId: 'assistant-1',
                commentText: 'I chose Product because the event mentions the roadmap. Confidence: 82%.',
                fromAssistant: true,
                commentType: 2,
            })
        )
        expect(admin.__mock.refs.get('items/target-project/tasks/task-1').update).toHaveBeenCalledWith(
            expect.objectContaining({
                commentsData: expect.objectContaining({
                    lastCommentOwnerId: 'assistant-1',
                    amount: 1,
                }),
                'calendarData.projectRouting': expect.objectContaining({
                    source: 'calendar_project_routing',
                    commentId: 'comment-1',
                }),
            })
        )
        expect(admin.__mock.refs.get('chatObjects/target-project/chats/task-1').set).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'task-1',
                type: 'tasks',
                commentsData: expect.objectContaining({ amount: 1 }),
            })
        )
    })

    test('updates existing chat metadata', async () => {
        admin.__mock.doc.mockImplementation(path => {
            const ref = {
                path,
                get: jest.fn(() => Promise.resolve({ exists: false, data: () => ({}) })),
                set: jest.fn(() => Promise.resolve()),
                update: jest.fn(() => Promise.resolve()),
            }

            if (path === 'projects/default-project') {
                ref.get = jest.fn(() => Promise.resolve({ exists: true, data: () => ({ assistantId: 'assistant-1' }) }))
            }
            if (path === 'chatObjects/target-project/chats/task-1') {
                ref.get = jest.fn(() =>
                    Promise.resolve({ exists: true, data: () => ({ commentsData: { amount: 3 } }) })
                )
            }

            admin.__mock.refs.set(path, ref)
            return ref
        })

        await addProjectRoutingReasonComment({
            userData: { defaultProjectId: 'default-project' },
            projectId: 'target-project',
            taskId: 'task-1',
            task: { id: 'task-1', name: 'Task', userId: 'user-1', commentsData: { amount: 2 } },
            projectName: 'Product',
            reasoning: 'it matches',
        })

        expect(admin.__mock.refs.get('chatObjects/target-project/chats/task-1').update).toHaveBeenCalledWith(
            expect.objectContaining({
                commentsData: expect.objectContaining({ amount: 4 }),
            })
        )
    })

    test('skips safely when no default assistant can be resolved', async () => {
        admin.__mock.doc.mockImplementation(path => {
            const ref = {
                path,
                get: jest.fn(() => Promise.resolve({ exists: false, data: () => ({}) })),
                set: jest.fn(() => Promise.resolve()),
                update: jest.fn(() => Promise.resolve()),
            }
            admin.__mock.refs.set(path, ref)
            return ref
        })
        admin.__mock.getAll.mockResolvedValue([{ exists: false }, { exists: false }])
        assistantsFirestore.getDefaultAssistantData.mockResolvedValue(null)

        const result = await addProjectRoutingReasonComment({
            userData: { defaultProjectId: 'default-project' },
            projectId: 'target-project',
            taskId: 'task-1',
            task: { id: 'task-1', name: 'Task', userId: 'user-1' },
            projectName: 'Product',
            reasoning: 'it matches',
        })

        expect(result).toBeNull()
        expect(admin.__mock.refs.get('items/target-project/tasks/task-1')).toBeUndefined()
    })
})
