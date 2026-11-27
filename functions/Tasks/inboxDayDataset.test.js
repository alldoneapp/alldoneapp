jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { increment: value => ({ __increment__: value }), delete: () => '__delete__' },
}))
jest.mock('firebase-admin', () => ({ firestore: jest.fn(() => ({})) }))
jest.mock('../BatchWrapper/batchWrapper', () => ({ BatchWrapper: jest.fn() }))
jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskDueDateChangedFeed: jest.fn(),
    createTaskPriorityChangedFeed: jest.fn(),
}))
jest.mock('../Followers/followerHelper', () => ({ tryAddFollower: jest.fn() }))
jest.mock('../GlobalState/globalState', () => ({ loadFeedsGlobalState: jest.fn() }))
jest.mock('../shared/FocusTaskService', () => ({ FocusTaskService: jest.fn() }))
jest.mock('../Utils/MapDataFuncions', () => ({
    mapProjectData: jest.fn((projectId, project) => ({ id: projectId, ...project })),
    mapTaskData: jest.fn((taskId, task) => ({ id: taskId, parentId: null, isPublicFor: [0], ...task })),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    DEFAULT_WORKSTREAM_ID: 'ws@default',
    FEED_PUBLIC_FOR_ALL: 0,
    OPEN_STEP: -1,
    generateSortIndex: jest.fn(() => 1),
}))

const {
    buildTaskEntry,
    closeInboxDay,
    detectDueDateMovesLater,
    getLocalDayBounds,
    isMoveOffToday,
    recordInboxDay,
    recordInboxPostponesIfChanged,
    resolveOutcome,
} = require('./inboxDayDataset')

const BACKLOG = Number.MAX_SAFE_INTEGER
const BERLIN = { zoneName: 'Europe/Berlin', offsetMinutes: null }
const HOUR = 60 * 60 * 1000
// Thu 26 Nov 2026 00:00 in Berlin (UTC+1) is 25 Nov 23:00 UTC.
const DAY_26 = Date.UTC(2026, 10, 25, 23)
const DAY_27 = DAY_26 + 24 * HOUR
const DAY_28 = DAY_27 + 24 * HOUR

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

// In-memory Firestore double: path-addressed docs, merge sets, and the where() chains the Today
// queries of autoPostponeTasksCloud run against items/{projectId}/tasks.
function buildDb(initialDocs = {}) {
    const store = new Map(Object.entries(initialDocs).map(([path, data]) => [path, clone(data)]))
    const snapshotOf = (path, data) => ({
        id: path.split('/').pop(),
        exists: data !== undefined,
        data: () => clone(data),
    })
    const matches = (data, [field, op, value]) => {
        const actual = data[field] === undefined ? null : data[field]
        if (op === '==') return actual === value
        if (op === '<=') return typeof actual === 'number' && actual <= value
        if (op === 'array-contains') return Array.isArray(actual) && actual.includes(value)
        if (op === 'array-contains-any') return Array.isArray(actual) && actual.some(item => value.includes(item))
        throw new Error(`Unsupported operator ${op}`)
    }
    const query = (path, filters = []) => ({
        where: (field, op, value) => query(path, [...filters, [field, op, value]]),
        get: async () => ({
            docs: [...store.entries()]
                .filter(([docPath]) => {
                    const rest = docPath.slice(path.length + 1)
                    return docPath.startsWith(`${path}/`) && rest && !rest.includes('/')
                })
                .filter(([, data]) => filters.every(filter => matches(data, filter)))
                .map(([docPath, data]) => snapshotOf(docPath, data)),
        }),
        doc: id => docRef(`${path}/${id}`),
    })
    const docRef = path => ({
        path,
        get: async () => snapshotOf(path, store.get(path)),
        set: async (data, options = {}) => {
            const previous = options.merge ? store.get(path) || {} : {}
            store.set(path, { ...previous, ...clone(data) })
        },
    })
    return { store, doc: docRef, collection: path => query(path) }
}

const userData = {
    timezone: 'Europe/Berlin',
    projectIds: ['p1'],
    inFocusTaskId: 'focus',
    inFocusTaskProjectId: 'p1',
}

const openTask = fields => ({
    name: 'Task',
    inDone: false,
    done: false,
    parentId: null,
    userId: 'u1',
    currentReviewerId: 'u1',
    isPublicFor: [0],
    observersIds: [],
    dueDateByObserversIds: {},
    timesPostponed: 0,
    priority: 'none',
    created: DAY_26 - 10 * 24 * HOUR,
    ...fields,
})

const updateEvent = ({ before, after, time, id = 'evt-1', taskId = 't1' }) => ({
    id,
    time: new Date(time).toISOString(),
    params: { projectId: 'p1', taskId },
    data: { before: { data: () => before }, after: { data: () => after } },
})

describe('detectDueDateMovesLater', () => {
    test('a primary due date moved later belongs to whoever has the task on Today', () => {
        expect(
            detectDueDateMovesLater(
                openTask({ dueDate: 1 }),
                openTask({ dueDate: 2, userId: 'owner', currentReviewerId: 'reviewer' })
            )
        ).toEqual([{ userId: 'reviewer', isObservedTask: false, from: 1, to: 2 }])
        expect(
            detectDueDateMovesLater(openTask({ dueDate: 1 }), openTask({ dueDate: 2, currentReviewerId: null }))
        ).toEqual([{ userId: 'u1', isObservedTask: false, from: 1, to: 2 }])
    })

    test('earlier dates, done tasks and subtasks are not postponements', () => {
        expect(detectDueDateMovesLater(openTask({ dueDate: 2 }), openTask({ dueDate: 1 }))).toEqual([])
        expect(detectDueDateMovesLater(openTask({ dueDate: 1 }), openTask({ dueDate: 2, inDone: true }))).toEqual([])
        expect(detectDueDateMovesLater(openTask({ dueDate: 1, parentId: 'x' }), openTask({ dueDate: 2 }))).toEqual([])
        expect(detectDueDateMovesLater(null, openTask({ dueDate: 2 }))).toEqual([])
    })

    test('each observer has their own date; a former observer does not count', () => {
        const before = openTask({ dueDate: 1, observersIds: ['o1', 'o2'], dueDateByObserversIds: { o1: 1, o2: 1 } })
        const after = openTask({ dueDate: 1, observersIds: ['o1'], dueDateByObserversIds: { o1: 5, o2: 5 } })
        expect(detectDueDateMovesLater(before, after)).toEqual([{ userId: 'o1', isObservedTask: true, from: 1, to: 5 }])
    })
})

describe('isMoveOffToday', () => {
    const now = DAY_26 + 9 * HOUR
    const args = { timezoneContext: BERLIN, now }
    test('only a move from today or earlier to a later day leaves Today', () => {
        expect(isMoveOffToday({ ...args, from: DAY_26 + 8 * HOUR, to: DAY_27 + 8 * HOUR })).toBe(true)
        expect(isMoveOffToday({ ...args, from: DAY_26 - 5 * 24 * HOUR, to: BACKLOG })).toBe(true)
        expect(isMoveOffToday({ ...args, from: DAY_26 + 8 * HOUR, to: DAY_26 + 20 * HOUR })).toBe(false)
        expect(isMoveOffToday({ ...args, from: DAY_27 + 8 * HOUR, to: DAY_28 + 8 * HOUR })).toBe(false)
    })
})

describe('getLocalDayBounds', () => {
    test('uses the user time zone', () => {
        expect(getLocalDayBounds('2026-11-26', BERLIN)).toEqual({ start: DAY_26, end: DAY_27 - 1 })
        expect(getLocalDayBounds('2026-11-26', { zoneName: null, offsetMinutes: 60 })).toEqual({
            start: DAY_26,
            end: DAY_27 - 1,
        })
    })
})

describe('buildTaskEntry', () => {
    test('records the features of a task as it stands on Today', () => {
        const entry = buildTaskEntry(
            openTask({
                id: 'focus',
                name: 'x'.repeat(300),
                dueDate: DAY_26 - 2 * 24 * HOUR,
                timesPostponed: 3,
                priority: 'should_do',
                estimations: { '-1': 45 },
                parentGoalId: 'g1',
                subtaskIds: ['s1', 's2'],
                gmailData: { threadId: 'th' },
                creatorId: 'assistant-1',
            }),
            { projectId: 'p1', userId: 'u1', focusKey: 'p1:focus', timezoneContext: BERLIN, now: DAY_26 + 9 * HOUR }
        )
        expect(entry).toEqual({
            key: 'p1:focus',
            projectId: 'p1',
            taskId: 'focus',
            name: 'x'.repeat(200),
            isObservedTask: false,
            dueDate: DAY_26 - 2 * 24 * HOUR,
            overdueDays: 2,
            created: DAY_26 - 10 * 24 * HOUR,
            timesPostponed: 3,
            priority: 'should_do',
            estimateMinutes: 45,
            parentGoalId: 'g1',
            recurrence: 'never',
            isFocus: true,
            subtaskCount: 2,
            origin: 'email',
            creatorId: 'assistant-1',
            waitingForOther: false,
        })
    })

    test('an observed task uses the observer date and estimate', () => {
        const entry = buildTaskEntry(
            openTask({
                id: 't9',
                userId: 'owner',
                currentReviewerId: 'owner',
                dueDate: DAY_28,
                dueDateByObserversIds: { u1: DAY_26 + HOUR },
                estimationsByObserverIds: { u1: 20 },
                creatorId: 'owner',
            }),
            { projectId: 'p1', userId: 'u1', isObservedTask: true, timezoneContext: BERLIN, now: DAY_26 + 9 * HOUR }
        )
        expect(entry).toMatchObject({
            key: 'p1:t9',
            isObservedTask: true,
            dueDate: DAY_26 + HOUR,
            overdueDays: 0,
            estimateMinutes: 20,
            origin: 'other',
            waitingForOther: false,
        })
    })
})

describe('recordInboxPostponesIfChanged', () => {
    test('records a swipe off Today under the user local day, with the task as it was', async () => {
        const db = buildDb({ 'users/u1': userData })
        const before = openTask({ dueDate: DAY_26 + 8 * HOUR, priority: 'could_do', timesPostponed: 1 })
        const after = {
            ...before,
            dueDate: DAY_27 + 8 * HOUR,
            priority: 'none',
            timesPostponed: 2,
            lastEditorId: 'u1',
            lastEditionDate: 77,
        }
        // 23:30 in Berlin on the 26th.
        const recorded = await recordInboxPostponesIfChanged(updateEvent({ before, after, time: DAY_27 - HOUR / 2 }), {
            db,
        })

        expect(recorded).toBe(1)
        const event = db.store.get('users/u1/inboxDays/2026-11-26/events/evt-1')
        expect(event).toMatchObject({
            at: DAY_27 - HOUR / 2,
            key: 'p1:t1',
            isObservedTask: false,
            from: DAY_26 + 8 * HOUR,
            to: DAY_27 + 8 * HOUR,
            toSomeday: false,
            editorId: 'u1',
            editionDate: 77,
            task: { key: 'p1:t1', priority: 'could_do', timesPostponed: 1, overdueDays: 0 },
        })
    })

    test('after local midnight the move belongs to the new day', async () => {
        const db = buildDb({ 'users/u1': userData })
        const before = openTask({ dueDate: DAY_26 + 8 * HOUR })
        const after = { ...before, dueDate: BACKLOG }
        await recordInboxPostponesIfChanged(updateEvent({ before, after, time: DAY_27 + HOUR / 2 }), { db })
        expect(db.store.get('users/u1/inboxDays/2026-11-27/events/evt-1')).toMatchObject({ toSomeday: true })
    })

    test('ignores assistants, moves that stay on Today and every other write', async () => {
        const db = buildDb({ 'users/u1': userData })
        const before = openTask({ dueDate: DAY_26 + 8 * HOUR, currentReviewerId: 'assistant-1' })
        const after = { ...before, dueDate: DAY_27 + 8 * HOUR }
        expect(
            await recordInboxPostponesIfChanged(updateEvent({ before, after, time: DAY_26 + 9 * HOUR }), { db })
        ).toBe(0)

        const sameDay = openTask({ dueDate: DAY_26 + 8 * HOUR })
        expect(
            await recordInboxPostponesIfChanged(
                updateEvent({
                    before: sameDay,
                    after: { ...sameDay, dueDate: DAY_26 + 20 * HOUR },
                    time: DAY_26 + 9 * HOUR,
                }),
                { db }
            )
        ).toBe(0)
        expect(
            await recordInboxPostponesIfChanged(
                updateEvent({ before: sameDay, after: { ...sameDay, name: 'Renamed' }, time: DAY_26 + 9 * HOUR }),
                { db }
            )
        ).toBe(0)
        expect([...db.store.keys()].filter(path => path.includes('/events/'))).toEqual([])
    })

    test('never throws', async () => {
        const db = { doc: () => ({ get: () => Promise.reject(new Error('unavailable')) }) }
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const before = openTask({ dueDate: DAY_26 + 8 * HOUR })
        await expect(
            recordInboxPostponesIfChanged(
                updateEvent({ before, after: { ...before, dueDate: DAY_28 }, time: DAY_26 + 9 * HOUR }),
                {
                    db,
                }
            )
        ).resolves.toBe(0)
        warn.mockRestore()
    })
})

describe('resolveOutcome', () => {
    const dayEnd = DAY_27 - 1
    const entry = { key: 'p1:t1', isObservedTask: false }
    const move = { key: 'p1:t1', at: DAY_26 + 9 * HOUR }

    test('done, gone, left and postponed', () => {
        expect(resolveOutcome({ entry, taskData: { inDone: true, completed: 5 }, userId: 'u1', dayEnd })).toMatchObject(
            {
                result: 'done',
                completedAt: 5,
            }
        )
        expect(resolveOutcome({ entry, taskData: null, userId: 'u1', dayEnd })).toMatchObject({ result: 'gone' })
        expect(resolveOutcome({ entry, current: { dueDate: DAY_26 }, userId: 'u1', dayEnd })).toMatchObject({
            result: 'left',
        })
        expect(
            resolveOutcome({ entry, current: { dueDate: DAY_27 + HOUR }, userId: 'u1', dayEnd, events: [move] })
        ).toMatchObject({ result: 'postponed', postponeCount: 1, lastPostponedAt: move.at })
        expect(
            resolveOutcome({ entry, taskData: openTask({ dueDate: BACKLOG }), userId: 'u1', dayEnd, events: [move] })
        ).toMatchObject({ result: 'postponed', dueDate: BACKLOG })
    })

    test('a later date without a move that day was set after the day ended: the user left it', () => {
        expect(resolveOutcome({ entry, taskData: openTask({ dueDate: DAY_28 }), userId: 'u1', dayEnd })).toEqual({
            result: 'left',
            dueDate: DAY_28,
            movedAfterDay: true,
            postponeCount: 0,
            lastPostponedAt: null,
        })
    })
})

describe('recordInboxDay', () => {
    const baseDocs = () => ({
        'users/u1': userData,
        'projects/p1': { active: true, userIds: ['u1'] },
        'items/p1/tasks/overdue': openTask({ name: 'Overdue', dueDate: DAY_26 - 2 * 24 * HOUR }),
        'items/p1/tasks/today': openTask({ name: 'Today', dueDate: DAY_26 + 8 * HOUR }),
        'items/p1/tasks/focus': openTask({ name: 'Focus', dueDate: DAY_26 + 9 * HOUR }),
        'items/p1/tasks/doneLater': openTask({ name: 'Will be done', dueDate: DAY_26 + 10 * HOUR }),
        'items/p1/tasks/swiped': openTask({ name: 'Swiped', dueDate: DAY_26 + 11 * HOUR }),
        'items/p1/tasks/tomorrow': openTask({ name: 'Tomorrow', dueDate: DAY_27 + 8 * HOUR }),
        'items/p1/tasks/someday': openTask({ name: 'Someday', dueDate: BACKLOG }),
        'items/p1/tasks/done': openTask({ name: 'Done', dueDate: DAY_26, inDone: true, done: true }),
        'items/p1/tasks/sub': openTask({ name: 'Sub', dueDate: DAY_26, parentId: 'today' }),
        'items/p1/tasks/observed': openTask({
            name: 'Observed',
            userId: 'owner',
            currentReviewerId: 'owner',
            dueDate: DAY_28,
            observersIds: ['u1'],
            dueDateByObserversIds: { u1: DAY_26 + 7 * HOUR },
        }),
    })
    const keysOf = list => list.map(entry => entry.taskId).sort()

    test('snapshots the Today list once per local day', async () => {
        const db = buildDb(baseDocs())
        const firstRun = DAY_26 + 10 * 60 * 1000 // 00:10 in Berlin
        const result = await recordInboxDay({ db, userId: 'u1', userData, now: firstRun, clock: () => 0 })
        expect(result).toMatchObject({ recorded: true, localDateKey: '2026-11-26', taskCount: 6 })

        const day = db.store.get('users/u1/inboxDays/2026-11-26')
        expect(day).toMatchObject({ schemaVersion: 1, snapshotAt: firstRun, snapshotLocalTime: '00:10', taskCount: 6 })
        expect(keysOf(day.tasks)).toEqual(['doneLater', 'focus', 'observed', 'overdue', 'swiped', 'today'])
        expect(day.tasks.find(entry => entry.taskId === 'focus').isFocus).toBe(true)
        expect(day.tasks.find(entry => entry.taskId === 'observed')).toMatchObject({
            isObservedTask: true,
            origin: 'self',
        })
        expect(day.tasks.find(entry => entry.taskId === 'overdue').overdueDays).toBe(2)

        expect(await recordInboxDay({ db, userId: 'u1', userData, now: firstRun + HOUR, clock: () => 0 })).toEqual({
            recorded: false,
            reason: 'already-recorded',
            localDateKey: '2026-11-26',
        })
    })

    test('the next day closes the day: done, postponed, left, gone and tasks added during the day', async () => {
        const db = buildDb(baseDocs())
        await recordInboxDay({ db, userId: 'u1', userData, now: DAY_26 + 10 * 60 * 1000, clock: () => 0 })

        // During the 26th.
        const swipe = async (taskId, to, time, id) => {
            const path = `items/p1/tasks/${taskId}`
            const before = db.store.get(path)
            const after = { ...before, dueDate: to, timesPostponed: (before.timesPostponed || 0) + 1 }
            await recordInboxPostponesIfChanged(updateEvent({ before, after, time, id, taskId }), { db })
            db.store.set(path, after)
        }
        await swipe('swiped', DAY_27 + 8 * HOUR, DAY_26 + 8 * HOUR, 'e-swiped') // to tomorrow (= the 27th)
        db.store.set('items/p1/tasks/doneLater', {
            ...db.store.get('items/p1/tasks/doneLater'),
            inDone: true,
            done: true,
            completed: DAY_26 + 12 * HOUR,
        })
        db.store.delete('items/p1/tasks/today')
        db.store.set(
            'items/p1/tasks/addedPostponed',
            openTask({ name: 'New, postponed', created: DAY_26 + 9 * HOUR, dueDate: DAY_26 + 9 * HOUR })
        )
        await swipe('addedPostponed', DAY_28, DAY_26 + 9 * HOUR + 60000, 'e-added')
        db.store.set(
            'items/p1/tasks/addedLeft',
            openTask({ name: 'New, left', created: DAY_26 + 13 * HOUR, dueDate: DAY_26 + 13 * HOUR })
        )
        // A move before the 27th's snapshot (the nightly auto-postpone at 00:05) is not about the 26th.
        await swipe('overdue', DAY_28 + 24 * HOUR, DAY_27 + 5 * 60 * 1000, 'e-nightly')

        const result = await recordInboxDay({
            db,
            userId: 'u1',
            userData,
            now: DAY_27 + 10 * 60 * 1000,
            clock: () => 0,
        })
        expect(result).toMatchObject({ recorded: true, localDateKey: '2026-11-27', closeResult: { closed: true } })

        const closed = db.store.get('users/u1/inboxDays/2026-11-26')
        const outcomeOf = taskId => closed.tasks.find(entry => entry.taskId === taskId).outcome
        expect(outcomeOf('doneLater')).toMatchObject({ result: 'done', completedAt: DAY_26 + 12 * HOUR })
        expect(outcomeOf('swiped')).toMatchObject({ result: 'postponed', postponeCount: 1, dueDate: DAY_27 + 8 * HOUR })
        expect(outcomeOf('today')).toMatchObject({ result: 'gone' })
        expect(outcomeOf('focus')).toMatchObject({ result: 'left' })
        expect(outcomeOf('observed')).toMatchObject({ result: 'left' })
        // Left on the 26th, moved by the nightly run after the day ended.
        expect(outcomeOf('overdue')).toMatchObject({ result: 'left', movedAfterDay: true, postponeCount: 0 })
        expect(closed.counts).toEqual({ listed: 6, done: 1, postponed: 1, left: 3, gone: 1 })

        expect(keysOf(closed.addedTasks)).toEqual(['addedLeft', 'addedPostponed'])
        const addedOutcome = taskId => closed.addedTasks.find(entry => entry.taskId === taskId).outcome
        expect(addedOutcome('addedPostponed')).toMatchObject({ result: 'postponed', dueDate: DAY_28 })
        expect(addedOutcome('addedLeft')).toMatchObject({ result: 'left' })
        expect(closed).toMatchObject({ postponeEventCount: 2, postponeEventsBeforeSnapshot: 0 })

        // The 27th's list: what was left plus what was postponed to the 27th.
        const next = db.store.get('users/u1/inboxDays/2026-11-27')
        expect(keysOf(next.tasks)).toEqual(['addedLeft', 'focus', 'observed', 'swiped', 'tomorrow'])
    })

    test('a closed day is not closed twice and a missing day is skipped', async () => {
        const db = buildDb({ 'users/u1/inboxDays/2026-11-26': { tasks: [], closedAt: 1 } })
        const args = { db, userId: 'u1', timezoneContext: BERLIN, todayEntries: [], now: DAY_27 }
        expect(await closeInboxDay({ ...args, localDateKey: '2026-11-26' })).toEqual({
            closed: false,
            reason: 'already-closed',
        })
        expect(await closeInboxDay({ ...args, localDateKey: '2026-11-25' })).toEqual({
            closed: false,
            reason: 'missing',
        })
    })

    test('the snapshot time is when the list was read, after the nightly moves of the same run', async () => {
        const db = buildDb(baseDocs())
        const runStart = DAY_26 + 5 * 60 * 1000
        const readAt = runStart + 40 * 1000
        await recordInboxDay({ db, userId: 'u1', userData, now: runStart, clock: () => readAt })
        expect(db.store.get('users/u1/inboxDays/2026-11-26').snapshotAt).toBe(readAt)
    })

    test('never throws', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const db = { doc: () => ({ get: () => Promise.reject(new Error('unavailable')) }) }
        await expect(recordInboxDay({ db, userId: 'u1', userData, now: DAY_26, clock: () => 0 })).resolves.toEqual({
            recorded: false,
            reason: 'failed',
        })
        warn.mockRestore()
    })
})
