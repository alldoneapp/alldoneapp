jest.mock('firebase-admin', () => {
    const refs = new Map()
    const doc = jest.fn(path => {
        if (!refs.has(path)) {
            refs.set(path, {
                path,
                set: jest.fn(() => Promise.resolve()),
                update: jest.fn(() => Promise.resolve()),
                delete: jest.fn(() => Promise.resolve()),
            })
        }
        return refs.get(path)
    })

    return {
        firestore: jest.fn(() => ({
            doc,
        })),
        __mock: {
            doc,
            refs,
            reset: () => {
                refs.clear()
                doc.mockClear()
            },
        },
    }
})

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    OPEN_STEP: 'open',
}))

jest.mock('../shared/projectRoutingCommentHelper', () => ({
    addProjectRoutingReasonComment: jest.fn(() => Promise.resolve({ commentId: 'comment-1' })),
}))

const admin = require('firebase-admin')
const { addProjectRoutingReasonComment } = require('../shared/projectRoutingCommentHelper')
const { addOrUpdateCalendarTask } = require('./calendarTasks')

const event = {
    id: 'event-1',
    summary: 'Product meeting',
    description: 'Roadmap',
    htmlLink: 'https://calendar.google.com/event',
    start: { dateTime: '2026-04-24T12:00:00Z' },
    end: { dateTime: '2026-04-24T13:00:00Z' },
}

describe('calendarTasks routing', () => {
    beforeEach(() => {
        admin.__mock.reset()
        addProjectRoutingReasonComment.mockClear()
    })

    test('creates new routed tasks in the target project and stores the connected project as originalProjectId', async () => {
        await addOrUpdateCalendarTask('connected-project', 'target-project', null, event, 'user-1', 'me@example.com', 0)

        const targetRef = admin.__mock.refs.get('items/target-project/tasks/event-1')
        expect(targetRef.set).toHaveBeenCalledWith(
            expect.objectContaining({
                calendarData: expect.objectContaining({
                    email: 'me@example.com',
                    originalProjectId: 'connected-project',
                }),
                name: 'Product meeting',
            })
        )
    })

    test('moves unpinned existing tasks to the routed target project', async () => {
        const existingTask = {
            id: 'event-1',
            projectId: 'old-project',
            calendarData: {
                email: 'me@example.com',
                originalProjectId: 'connected-project',
            },
            name: 'Old title',
            extendedName: 'Old title',
            description: '',
            estimations: { open: 30 },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            event,
            'user-1',
            'me@example.com',
            0
        )

        expect(admin.__mock.refs.get('items/target-project/tasks/event-1').set).toHaveBeenCalledWith(
            expect.objectContaining({
                calendarData: expect.objectContaining({
                    originalProjectId: 'connected-project',
                }),
            }),
            { merge: true }
        )
        expect(admin.__mock.refs.get('items/old-project/tasks/event-1').delete).toHaveBeenCalled()
    })

    test('adds a routing reason comment when creating a newly routed task', async () => {
        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            null,
            event,
            'user-1',
            'me@example.com',
            0,
            {
                matched: true,
                targetProjectId: 'target-project',
                reasoning: 'The event mentions the product roadmap.',
                confidence: 0.88,
                projectName: 'Product',
            },
            { defaultProjectId: 'default-project' }
        )

        expect(addProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                userData: { defaultProjectId: 'default-project' },
                projectId: 'target-project',
                taskId: 'event-1',
                projectName: 'Product',
                reasoning: 'The event mentions the product roadmap.',
                confidence: 0.88,
                source: 'calendar_project_routing',
                sourceDataField: 'calendarData',
            })
        )
    })

    test('adds a routing reason comment when moving an existing routed task', async () => {
        const existingTask = {
            id: 'event-1',
            projectId: 'old-project',
            calendarData: {
                email: 'me@example.com',
                originalProjectId: 'connected-project',
                projectRouting: {
                    chosenProjectId: 'old-project',
                    commentId: 'old-comment',
                },
            },
            name: 'Old title',
            extendedName: 'Old title',
            description: '',
            estimations: { open: 30 },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            event,
            'user-1',
            'me@example.com',
            0,
            {
                matched: true,
                targetProjectId: 'target-project',
                reasoning: 'The event now matches Product.',
                confidence: 0.91,
                projectName: 'Product',
            },
            { defaultProjectId: 'default-project' }
        )

        expect(addProjectRoutingReasonComment).toHaveBeenCalledWith(
            expect.objectContaining({
                projectId: 'target-project',
                taskId: 'event-1',
                reasoning: 'The event now matches Product.',
            })
        )
    })

    test('does not duplicate routing comments when the chosen project is unchanged', async () => {
        const existingTask = {
            id: 'event-1',
            projectId: 'target-project',
            calendarData: {
                email: 'me@example.com',
                originalProjectId: 'connected-project',
                projectRouting: {
                    chosenProjectId: 'target-project',
                    commentId: 'existing-comment',
                },
            },
            name: 'Product meeting',
            extendedName: 'Product meeting',
            description: 'Roadmap',
            estimations: { open: 60 },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            event,
            'user-1',
            'me@example.com',
            0,
            {
                matched: true,
                targetProjectId: 'target-project',
                reasoning: 'Same decision.',
                confidence: 0.91,
                projectName: 'Product',
            },
            { defaultProjectId: 'default-project' }
        )

        expect(addProjectRoutingReasonComment).not.toHaveBeenCalled()
    })

    test('does not move pinned existing tasks between projects', async () => {
        const existingTask = {
            id: 'event-1',
            projectId: 'old-project',
            calendarData: {
                email: 'me@example.com',
                originalProjectId: 'connected-project',
                pinnedToProjectId: 'old-project',
            },
            name: 'Old title',
            extendedName: 'Old title',
            description: '',
            estimations: { open: 30 },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            event,
            'user-1',
            'me@example.com',
            0
        )

        expect(admin.__mock.refs.get('items/target-project/tasks/event-1')).toBeUndefined()
        expect(admin.__mock.refs.get('items/old-project/tasks/event-1').delete).not.toHaveBeenCalled()
        expect(admin.__mock.refs.get('items/old-project/tasks/event-1').update).toHaveBeenCalled()
    })
})
