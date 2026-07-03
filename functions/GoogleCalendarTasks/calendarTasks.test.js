jest.mock('firebase-admin', () => {
    const refs = new Map()
    const collectionDocs = new Map()
    const collectionQueries = []
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

    const collection = jest.fn(path => {
        const filters = []
        const query = {
            where: jest.fn((field, operator, value) => {
                filters.push({ field, operator, value })
                return query
            }),
            get: jest.fn(() => {
                let docs = collectionDocs.get(path) || []
                filters.forEach(({ field, operator, value }) => {
                    if (field === '__name__' && operator === 'in') {
                        docs = docs.filter(item => value.includes(item.id))
                    }
                })
                const queryDocs = docs.map(item => ({ id: item.id, data: () => item.data }))
                return Promise.resolve({
                    docs: queryDocs,
                    forEach: callback => queryDocs.forEach(callback),
                })
            }),
        }
        collectionQueries.push({ path, query })
        return query
    })

    const firestore = jest.fn(() => ({ doc, collection }))
    firestore.FieldPath = { documentId: jest.fn(() => '__name__') }

    return {
        firestore,
        __mock: {
            doc,
            collectionDocs,
            collectionQueries,
            refs,
            setCollectionDocs: (path, docs) => collectionDocs.set(path, docs),
            reset: () => {
                refs.clear()
                collectionDocs.clear()
                collectionQueries.length = 0
                doc.mockClear()
                collection.mockClear()
                firestore.FieldPath.documentId.mockClear()
            },
        },
    }
})

jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(),
}))

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: class {
        constructor(db) {
            this.db = db
        }

        update(ref, data) {
            return ref.update(data)
        }

        set(ref, data, options) {
            return ref.set(data, options)
        }

        delete(ref) {
            return ref.delete()
        }

        commit() {
            return Promise.resolve()
        }
    },
}))

jest.mock('../Utils/statisticsHelper', () => ({
    updateStatistics: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    ESTIMATION_0_MIN: 0,
    FEED_PUBLIC_FOR_ALL: 0,
    OPEN_STEP: 'open',
    RECURRENCE_NEVER: 'never',
    TASK_ASSIGNEE_USER_TYPE: 'user',
    generateNegativeSortIndex: jest.fn(() => -1),
    getTaskNameWithoutMeta: jest.fn(value => value),
}))

jest.mock('../shared/projectRoutingCommentHelper', () => ({
    addProjectRoutingReasonComment: jest.fn(() => Promise.resolve({ commentId: 'comment-1' })),
}))

const admin = require('firebase-admin')
const { addProjectRoutingReasonComment } = require('../shared/projectRoutingCommentHelper')
const { updateStatistics } = require('../Utils/statisticsHelper')
const {
    addOrUpdateCalendarTask,
    getCalendarTasksByEventIdsInProject,
    resolveCalendarRoutingForEvent,
} = require('./calendarTasks')

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
        updateStatistics.mockClear()
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

    test('preserves a completed multi-day event found by its calendar event id', async () => {
        const multiDayEvent = {
            ...event,
            start: { date: '2026-06-26' },
            end: { date: '2026-06-29' },
        }
        const existingTask = {
            id: 'event-1',
            projectId: 'target-project',
            userId: 'user-1',
            done: true,
            inDone: true,
            completed: Date.parse('2026-06-26T08:00:00Z'),
            calendarData: {
                link: event.htmlLink,
                start: multiDayEvent.start,
                end: multiDayEvent.end,
                email: 'me@example.com',
                provider: 'google',
                originalProjectId: 'connected-project',
            },
            name: event.summary,
            extendedName: event.summary,
            description: event.description,
            estimations: { open: 480 },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            multiDayEvent,
            'user-1',
            'me@example.com',
            0
        )

        const targetRef = admin.__mock.refs.get('items/target-project/tasks/event-1')
        expect(targetRef.set).not.toHaveBeenCalled()
        expect(targetRef.update).toHaveBeenCalledWith(
            expect.objectContaining({
                estimations: { open: 0 },
            })
        )
        expect(updateStatistics).toHaveBeenNthCalledWith(
            1,
            'target-project',
            'user-1',
            480,
            true,
            true,
            existingTask.completed,
            expect.anything()
        )
        expect(updateStatistics).toHaveBeenNthCalledWith(
            2,
            'target-project',
            'user-1',
            0,
            false,
            true,
            existingTask.completed,
            expect.anything()
        )
    })

    test('creates all-day events with zero logged minutes', async () => {
        const allDayEvent = {
            ...event,
            start: { date: '2026-06-26' },
            end: { date: '2026-06-29' },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            null,
            allDayEvent,
            'user-1',
            'me@example.com',
            0
        )

        expect(admin.__mock.refs.get('items/target-project/tasks/event-1').set).toHaveBeenCalledWith(
            expect.objectContaining({ estimations: { open: 0 } })
        )
    })

    test('finds completed events from previous days by exact event id', async () => {
        admin.__mock.setCollectionDocs('items/target-project/tasks', [
            {
                id: 'event-1',
                data: {
                    userId: 'user-1',
                    done: true,
                    inDone: true,
                    completed: Date.parse('2026-06-26T08:00:00Z'),
                    name: 'Multi-day event',
                    calendarData: {
                        start: { date: '2026-06-26' },
                        end: { date: '2026-06-29' },
                    },
                },
            },
        ])

        const tasks = await getCalendarTasksByEventIdsInProject('target-project', 'user-1', ['event-1'])

        expect(tasks).toEqual([
            expect.objectContaining({
                id: 'event-1',
                projectId: 'target-project',
                done: true,
                completed: Date.parse('2026-06-26T08:00:00Z'),
            }),
        ])
        expect(admin.firestore.FieldPath.documentId).toHaveBeenCalled()
        expect(admin.__mock.collectionQueries[0].query.where).toHaveBeenCalledWith('__name__', 'in', ['event-1'])
    })

    describe('resolveCalendarRoutingForEvent', () => {
        test('uses the classifier decision for events that have not been routed yet', () => {
            const decision = { matched: true, targetProjectId: 'target-project', reasoning: 'x', confidence: 0.9 }

            expect(resolveCalendarRoutingForEvent(undefined, decision, 'connected-project')).toEqual({
                routingDecision: expect.objectContaining({ matched: true, targetProjectId: 'target-project' }),
                targetProjectId: 'target-project',
            })
        })

        test('falls back to the connected project when the new decision has no match', () => {
            const decision = { matched: false, targetProjectId: null }

            expect(resolveCalendarRoutingForEvent(undefined, decision, 'connected-project')).toEqual({
                routingDecision: expect.objectContaining({ matched: false }),
                targetProjectId: 'connected-project',
            })
        })

        test('keeps already-routed tasks in place and drops the routing decision so no re-comment fires', () => {
            const existingTask = {
                id: 'event-1',
                projectId: 'routed-project',
                calendarData: {
                    projectRouting: { chosenProjectId: 'routed-project', commentId: 'existing-comment' },
                },
            }
            // A fresh (and possibly different) classifier decision must be ignored entirely.
            const noisyDecision = { matched: true, targetProjectId: 'some-other-project', confidence: 0.71 }

            expect(resolveCalendarRoutingForEvent(existingTask, noisyDecision, 'connected-project')).toEqual({
                routingDecision: null,
                targetProjectId: 'routed-project',
            })
        })

        test('still routes existing tasks that were never routed (no stored commentId)', () => {
            const existingTask = {
                id: 'event-1',
                projectId: 'connected-project',
                calendarData: { email: 'me@example.com' },
            }
            const decision = { matched: true, targetProjectId: 'target-project', confidence: 0.9 }

            expect(resolveCalendarRoutingForEvent(existingTask, decision, 'connected-project')).toEqual({
                routingDecision: expect.objectContaining({ targetProjectId: 'target-project' }),
                targetProjectId: 'target-project',
            })
        })
    })

    test('does not add classifier routing comments to pinned tasks kept in another project', async () => {
        const existingTask = {
            id: 'event-1',
            projectId: 'family-project',
            calendarData: {
                email: 'me@example.com',
                originalProjectId: 'connected-project',
                pinnedToProjectId: 'family-project',
            },
            name: 'Partner conference',
            extendedName: 'Partner conference',
            description: '',
            estimations: { open: 30 },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'juno-project',
            existingTask,
            event,
            'user-1',
            'me@example.com',
            0,
            {
                matched: true,
                targetProjectId: 'juno-project',
                reasoning: 'The event matches Juno.',
                confidence: 0.86,
                projectName: 'JTL Software - Project Juno',
            },
            { defaultProjectId: 'default-project' }
        )

        expect(addProjectRoutingReasonComment).not.toHaveBeenCalled()
    })
})
