const mockFieldPath = { documentId: jest.fn(() => '__name__') }
jest.mock('firebase-admin/firestore', () => ({ FieldPath: mockFieldPath }))
const { FieldPath } = require('firebase-admin/firestore')
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
    firestore.FieldPath = mockFieldPath

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

    test('stores the recurring series id so a later manual move can teach future occurrences', async () => {
        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            null,
            { ...event, recurringEventId: 'series-1' },
            'user-1',
            'me@example.com',
            0
        )

        expect(admin.__mock.refs.get('items/target-project/tasks/event-1').set).toHaveBeenCalledWith(
            expect.objectContaining({
                calendarData: expect.objectContaining({ recurringEventId: 'series-1' }),
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
                tokenUsage: { auditModel: 'gpt-5.6-terra' },
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
                secondPassUsed: true,
                secondPassModel: 'gpt-5.6-terra',
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

    test('reopens a completed event when it is rescheduled to a later calendar day', async () => {
        const rescheduledEvent = {
            ...event,
            start: { dateTime: '2026-04-25T12:00:00Z' },
            end: { dateTime: '2026-04-25T13:00:00Z' },
        }
        const existingTask = {
            id: 'event-1',
            projectId: 'target-project',
            userId: 'user-1',
            userIds: ['user-1'],
            stepHistory: ['open'],
            currentReviewerId: -2,
            done: true,
            inDone: true,
            completed: Date.parse('2026-04-24T08:00:00Z'),
            completedTime: '08:00',
            calendarData: {
                link: event.htmlLink,
                start: event.start,
                end: event.end,
                email: 'me@example.com',
                provider: 'google',
                originalProjectId: 'connected-project',
            },
            name: event.summary,
            extendedName: event.summary,
            description: event.description,
            estimations: { open: 60 },
            subtaskIds: ['subtask-1'],
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            rescheduledEvent,
            'user-1',
            'me@example.com',
            0
        )

        expect(admin.__mock.refs.get('items/target-project/tasks/event-1').update).toHaveBeenCalledWith(
            expect.objectContaining({
                calendarData: expect.objectContaining({ start: rescheduledEvent.start }),
                done: false,
                inDone: false,
                completed: null,
                completedDate: null,
                completedTime: null,
                userIds: ['user-1'],
                stepHistory: ['open'],
                currentReviewerId: 'user-1',
                dueDate: expect.any(Number),
                sortIndex: expect.any(Number),
                workflowAiPromptOverride: null,
            })
        )
        expect(updateStatistics).toHaveBeenCalledTimes(1)
        expect(updateStatistics).toHaveBeenCalledWith(
            'target-project',
            'user-1',
            60,
            true,
            false,
            existingTask.completed,
            expect.anything()
        )
        expect(admin.__mock.refs.get('items/target-project/tasks/subtask-1').update).toHaveBeenCalledWith(
            expect.objectContaining({
                completed: null,
                userIds: ['user-1'],
                currentReviewerId: 'user-1',
                parentDone: false,
                inDone: false,
            })
        )
    })

    test('keeps a completed event done when only its time changes on the same day', async () => {
        const rescheduledEvent = {
            ...event,
            start: { dateTime: '2026-04-24T16:00:00Z' },
            end: { dateTime: '2026-04-24T17:00:00Z' },
        }
        const existingTask = {
            id: 'event-1',
            projectId: 'target-project',
            userId: 'user-1',
            userIds: ['user-1'],
            stepHistory: ['open'],
            currentReviewerId: -2,
            done: true,
            inDone: true,
            completed: Date.parse('2026-04-24T08:00:00Z'),
            calendarData: {
                link: event.htmlLink,
                start: event.start,
                end: event.end,
                email: 'me@example.com',
                provider: 'google',
                originalProjectId: 'connected-project',
            },
            name: event.summary,
            extendedName: event.summary,
            description: event.description,
            estimations: { open: 60 },
        }

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            rescheduledEvent,
            'user-1',
            'me@example.com',
            0
        )

        const update = admin.__mock.refs.get('items/target-project/tasks/event-1').update.mock.calls[0][0]
        expect(update).toEqual(
            expect.objectContaining({ calendarData: expect.objectContaining({ start: rescheduledEvent.start }) })
        )
        expect(update).not.toHaveProperty('done')
        expect(update).not.toHaveProperty('inDone')
        expect(update).not.toHaveProperty('completed')
        expect(updateStatistics).not.toHaveBeenCalled()
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
        expect(FieldPath.documentId).toHaveBeenCalled()
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

describe('AT-2351 - the sync writes a plain arrival index and never re-sorts a meeting', () => {
    const buildExistingTask = (overrides = {}) => ({
        id: 'event-1',
        projectId: 'target-project',
        created: Date.parse('2026-04-20T08:00:00Z'),
        calendarData: {
            link: event.htmlLink,
            start: event.start,
            end: event.end,
            email: 'me@example.com',
            provider: 'google',
            originalProjectId: 'connected-project',
        },
        name: event.summary,
        extendedName: event.summary,
        description: event.description,
        estimations: { open: 60 },
        ...overrides,
    })

    beforeEach(() => {
        admin.__mock.reset()
        addProjectRoutingReasonComment.mockClear()
        updateStatistics.mockClear()
    })

    test('creates the task with an ordinary arrival index, not one derived from the event', async () => {
        await addOrUpdateCalendarTask('connected-project', 'target-project', null, event, 'user-1', 'me@example.com', 0)

        const written = admin.__mock.refs.get('items/target-project/tasks/event-1').set.mock.calls[0][0]
        const eventStart = Date.parse(event.start.dateTime || event.start.date)

        // An ordinary positive "arrived now" index - the same shape every non-calendar task gets.
        expect(written.sortIndex).toBeGreaterThan(0)
        // Never the event start (AT-2259) and never the reserved band (AT-2270).
        expect(written.sortIndex).not.toBe(eventStart)
        expect(written.sortIndex).toBeGreaterThan(-1e13)
    })

    test('does not write a sortIndex when a rescheduled event moves the task', async () => {
        const rescheduled = {
            ...event,
            start: { dateTime: '2026-04-24T16:00:00Z' },
            end: { dateTime: '2026-04-24T17:00:00Z' },
        }
        const existingTask = buildExistingTask({ sortIndex: Date.parse('2026-04-21T10:00:00Z') })

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            rescheduled,
            'user-1',
            'me@example.com',
            0
        )

        // The meeting moves among the other meetings because calendarData.start moved; the list
        // reads that field directly. Nothing needs to re-sort it, so nothing writes sortIndex.
        const updateCall = admin.__mock.refs.get('items/target-project/tasks/event-1').update.mock.calls[0][0]
        expect(updateCall).not.toHaveProperty('sortIndex')
        expect(updateCall.calendarData.start).toEqual(rescheduled.start)
    })

    test('leaves a task the user rearranged exactly where it is, even when the event moves', async () => {
        const rescheduled = {
            ...event,
            start: { dateTime: '2026-04-24T16:00:00Z' },
            end: { dateTime: '2026-04-24T17:00:00Z' },
        }
        const existingTask = buildExistingTask({ sortIndex: Date.parse('2026-04-23T11:22:33.444Z') })

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            rescheduled,
            'user-1',
            'me@example.com',
            0
        )

        const updateCall = admin.__mock.refs.get('items/target-project/tasks/event-1').update.mock.calls[0][0]
        expect(updateCall).not.toHaveProperty('sortIndex')
    })

    test('does not write anything when nothing about the event changed', async () => {
        const existingTask = buildExistingTask({ sortIndex: Date.parse('2026-04-21T10:00:00Z') })

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
    })

    test('carries the existing ordering across a project move', async () => {
        const placed = Date.parse('2026-04-23T11:22:33.444Z')
        const existingTask = buildExistingTask({ projectId: 'old-project', sortIndex: placed })

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
            expect.objectContaining({ sortIndex: placed }),
            { merge: true }
        )
    })

    test('gives a task with no ordering at all one on a project move', async () => {
        const existingTask = buildExistingTask({ projectId: 'old-project', sortIndex: undefined })

        await addOrUpdateCalendarTask(
            'connected-project',
            'target-project',
            existingTask,
            event,
            'user-1',
            'me@example.com',
            0
        )

        const written = admin.__mock.refs.get('items/target-project/tasks/event-1').set.mock.calls[0][0]
        expect(written.sortIndex).toBeGreaterThan(0)
    })
})
