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

const admin = require('firebase-admin')
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
