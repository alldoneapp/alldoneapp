const {
    DailyPlanError,
    executeApplyDailyPlan,
    loadSomedayHoldTaskKeys,
    normalizeDailyPlanRequest,
} = require('./dailyPlanService')
const { reverseAction } = require('../shared/UndoActionService')

const mockFindAndSetNewFocusTask = jest.fn(() => Promise.resolve())
jest.mock('../shared/FocusTaskService', () => ({
    FocusTaskService: jest.fn().mockImplementation(() => ({ findAndSetNewFocusTask: mockFindAndSetNewFocusTask })),
}))
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { delete: () => '__delete__', increment: value => ({ __increment__: value }) },
}))

// Mon 23 Nov 2026 10:00 in UTC+1.
const OFFSET = 60
const NOW = Date.UTC(2026, 10, 23, 9)
const DAY = 24 * 60 * 60 * 1000
const DATE_KEY = '2026-11-23'
const BACKLOG = Number.MAX_SAFE_INTEGER

const task = fields => ({
    name: 'Task',
    inDone: false,
    done: false,
    parentId: null,
    currentReviewerId: 'u1',
    userId: 'u1',
    isPublicFor: [0],
    dueDate: NOW - DAY,
    timesPostponed: 0,
    priority: 'none',
    ...fields,
})

// Minimal Firestore double: path-addressed docs, a transaction that records writes and applies
// them on commit, and the one query loadSomedayHoldTaskKeys runs.
function buildDb({ docs = {}, failPlanQuery = false } = {}) {
    const store = new Map(Object.entries(docs).map(([path, data]) => [path, JSON.parse(JSON.stringify(data))]))
    const writes = []
    const reads = []
    const ref = path => ({ path })
    const get = path => {
        reads.push(path)
        const data = store.get(path)
        return {
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
            ref: ref(path),
        }
    }
    const setNested = (target, field, value) => {
        const parts = field.split('.')
        let current = target
        parts.slice(0, -1).forEach(part => {
            current[part] = current[part] || {}
            current = current[part]
        })
        if (value === '__delete__') delete current[parts[parts.length - 1]]
        else current[parts[parts.length - 1]] = value
    }
    const db = {
        doc: ref,
        collection: path => ({
            orderBy: () => ({
                limit: () => ({
                    get: async () => {
                        if (failPlanQuery) throw new Error('unavailable')
                        const plans = [...store.entries()]
                            .filter(([key]) => key.startsWith(`${path}/`))
                            .map(([, data]) => data)
                            .sort((a, b) => b.appliedAt - a.appliedAt)
                        return { docs: plans.slice(0, 1).map(data => ({ data: () => data })) }
                    },
                }),
            }),
        }),
        runTransaction: async callback => {
            const pending = []
            let wrote = false
            const result = await callback({
                get: async reference => {
                    if (wrote) throw new Error('Firestore transactions require all reads before writes')
                    return get(reference.path)
                },
                update: (reference, data) => {
                    wrote = true
                    pending.push({ type: 'update', path: reference.path, data })
                },
                set: (reference, data) => {
                    wrote = true
                    pending.push({ type: 'set', path: reference.path, data })
                },
                delete: reference => pending.push({ type: 'delete', path: reference.path }),
            })
            pending.forEach(write => {
                writes.push(write)
                if (write.type === 'set') store.set(write.path, JSON.parse(JSON.stringify(write.data)))
                if (write.type === 'update') {
                    const current = store.get(write.path) || {}
                    Object.entries(write.data).forEach(([field, value]) => setNested(current, field, value))
                    store.set(write.path, current)
                }
            })
            return result
        },
    }
    return { db, store, writes, reads }
}

const baseDocs = (tasks, extra = {}) => ({
    'projects/p1': { name: 'Product', userIds: ['u1', 'u2'] },
    'projects/p2': { name: 'Client', userIds: ['u1'] },
    'users/u1': { inFocusTaskId: null },
    ...Object.fromEntries(Object.entries(tasks).map(([key, value]) => [`items/${key}`, value])),
    ...extra,
})

const request = (tasks, fields = {}) => ({
    requestId: 'req-1',
    timezoneOffset: OFFSET,
    localDateKey: DATE_KEY,
    tasks,
    ...fields,
})

const apply = (fixture, data, actorUserId = 'u1', now = NOW) =>
    executeApplyDailyPlan({ actorUserId, data, db: fixture.db, now })

describe('normalizeDailyPlanRequest', () => {
    it('validates ids, decisions, priorities and duplicates', () => {
        const ok = { projectId: 'p1', taskId: 't1', decision: 'plan', priority: 'must_do', isObservedTask: false }
        expect(normalizeDailyPlanRequest(request([ok])).tasks[0]).toMatchObject({ key: 'p1:t1', priority: 'must_do' })
        const bad = [
            request([{ ...ok, decision: 'delete' }]),
            request([{ ...ok, priority: 'do_later' }]),
            request([{ ...ok, projectId: 'p1/x' }]),
            request([{ ...ok, isObservedTask: 'no' }]),
            request([ok, ok]),
            request([]),
            request([ok], { localDateKey: 'today' }),
            request([ok], { timezoneOffset: 9999 }),
            request([ok], { requestId: '' }),
        ]
        bad.forEach(data => expect(() => normalizeDailyPlanRequest(data)).toThrow(DailyPlanError))
    })

    it('clamps client estimates (display only) and ignores confirmSomeday outside postpone', () => {
        const [item] = normalizeDailyPlanRequest(
            request([
                {
                    projectId: 'p1',
                    taskId: 't1',
                    decision: 'keep',
                    isObservedTask: false,
                    estimateMinutes: 99999,
                    confirmSomeday: true,
                },
            ])
        ).tasks
        expect(item).toMatchObject({ estimateMinutes: 1440, confirmSomeday: false })
    })
})

describe('executeApplyDailyPlan', () => {
    beforeEach(() => mockFindAndSetNewFocusTask.mockClear())

    it('writes priorities, postpones along the existing ladder and records one undoable action + plan', async () => {
        const fixture = buildDb({
            docs: baseDocs({
                'p1/tasks/plan': task({ priority: 'none' }),
                'p1/tasks/same': task({ priority: 'must_do' }),
                'p1/tasks/move': task({ timesPostponed: 1, priority: 'should_do' }),
                'p2/tasks/keep': task({ priority: 'could_do' }),
            }),
        })
        const result = await apply(
            fixture,
            request([
                {
                    projectId: 'p1',
                    taskId: 'plan',
                    decision: 'plan',
                    priority: 'should_do',
                    isObservedTask: false,
                    estimateMinutes: 30,
                },
                {
                    projectId: 'p1',
                    taskId: 'same',
                    decision: 'plan',
                    priority: 'must_do',
                    isObservedTask: false,
                    estimateMinutes: 60,
                },
                { projectId: 'p1', taskId: 'move', decision: 'postpone', isObservedTask: false },
                { projectId: 'p2', taskId: 'keep', decision: 'keep', isObservedTask: false },
            ])
        )

        expect(result).toMatchObject({
            success: true,
            actionId: 'req-1',
            updatedTaskCount: 3,
            plannedCount: 2,
            postponedCount: 1,
            keptCount: 1,
            skipped: [],
        })
        expect(fixture.store.get('items/p1/tasks/plan').priority).toBe('should_do')
        expect(fixture.writes.some(write => write.path === 'items/p1/tasks/same')).toBe(false)
        const moved = fixture.store.get('items/p1/tasks/move')
        // timesPostponed 1 → one week, from the user's local now.
        expect(moved).toMatchObject({ dueDate: NOW + 7 * DAY, timesPostponed: 2, priority: 'none' })
        expect(fixture.store.get('items/p2/tasks/keep').priority).toBe('do_later')

        const action = fixture.store.get('users/u1/undoActions/req-1')
        expect(action.operations).toHaveLength(3)
        action.operations.forEach(operation => {
            expect(operation).toMatchObject({
                skipIfChanged: true,
                skipIfMissing: true,
                requiredCurrentFields: { inDone: false },
            })
            // Undo only ever compares/restores the fields the plan changed.
            expect(Object.keys(operation.after)).not.toContain('lastEditionDate')
        })
        expect(action.operations[1]).toMatchObject({
            objectId: 'move',
            before: { dueDate: NOW - DAY, timesPostponed: 1, priority: 'should_do' },
        })

        const plan = fixture.store.get(`users/u1/dailyPlans/${DATE_KEY}`)
        expect(plan).toMatchObject({
            actionId: 'req-1',
            plannedMinutes: 90,
            postponedTaskKeys: ['p1:move'],
            keptTaskKeys: ['p2:keep'],
            somedayHoldTaskKeys: [],
        })
        expect(plan.planned.map(item => item.key)).toEqual(['p1:plan', 'p1:same'])
    })

    it('never sends a task to Someday without explicit confirmation, and records the hold', async () => {
        const fixture = buildDb({
            docs: baseDocs({
                'p1/tasks/old': task({ timesPostponed: 6, priority: 'none' }),
                'p1/tasks/kept': task({ timesPostponed: 7, priority: 'should_do' }),
                'p1/tasks/yes': task({ timesPostponed: 6 }),
            }),
        })
        const result = await apply(
            fixture,
            request([
                { projectId: 'p1', taskId: 'old', decision: 'postpone', isObservedTask: false },
                { projectId: 'p1', taskId: 'kept', decision: 'keep', isObservedTask: false },
                { projectId: 'p1', taskId: 'yes', decision: 'postpone', isObservedTask: false, confirmSomeday: true },
            ])
        )
        expect(result.skipped).toEqual([{ projectId: 'p1', taskId: 'old', reason: 'someday-not-confirmed' }])
        expect(fixture.store.get('items/p1/tasks/old').dueDate).toBe(NOW - DAY)
        expect(fixture.store.get('items/p1/tasks/yes').dueDate).toBe(BACKLOG)
        const plan = fixture.store.get(`users/u1/dailyPlans/${DATE_KEY}`)
        expect(plan.somedayHoldTaskKeys.sort()).toEqual(['p1:kept', 'p1:old'])
        expect(plan.keptTaskKeys.sort()).toEqual(['p1:kept', 'p1:old'])
    })

    it('skips completed, future, Someday, missing and subtask entries instead of touching them', async () => {
        const fixture = buildDb({
            docs: baseDocs({
                'p1/tasks/done': task({ inDone: true }),
                'p1/tasks/future': task({ dueDate: NOW + 2 * DAY }),
                'p1/tasks/someday': task({ dueDate: BACKLOG }),
                'p1/tasks/sub': task({ parentId: 'x' }),
            }),
        })
        const decisions = ['done', 'future', 'someday', 'sub', 'missing'].map(taskId => ({
            projectId: 'p1',
            taskId,
            decision: 'postpone',
            isObservedTask: false,
        }))
        const result = await apply(fixture, request(decisions))
        expect(result.skipped.map(item => item.reason)).toEqual([
            'completed',
            'not-due-today',
            'not-due-today',
            'subtask',
            'not-found',
        ])
        expect(result.actionId).toBeNull()
        expect(fixture.writes.filter(write => write.path.startsWith('items/'))).toEqual([])
        expect(fixture.store.has('users/u1/undoActions/req-1')).toBe(false)
    })

    it('rejects projects the caller is not a member of and tasks the caller cannot see', async () => {
        const notMember = buildDb({ docs: baseDocs({ 'p2/tasks/t': task() }, { 'projects/p2': { userIds: ['u9'] } }) })
        await expect(
            apply(notMember, request([{ projectId: 'p2', taskId: 't', decision: 'keep', isObservedTask: false }]))
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(notMember.writes).toEqual([])

        const privateTask = buildDb({ docs: baseDocs({ 'p1/tasks/t': task({ isPublicFor: ['u2'] }) }) })
        await expect(
            apply(
                privateTask,
                request([
                    { projectId: 'p1', taskId: 't', decision: 'plan', priority: 'must_do', isObservedTask: false },
                ])
            )
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(privateTask.writes).toEqual([])
    })

    it('moves only the observer date of an observed task and never the owner’s priority', async () => {
        const observed = task({
            currentReviewerId: 'u2',
            userId: 'u2',
            observersIds: ['u1'],
            dueDate: NOW + 10 * DAY,
            dueDateByObserversIds: { u1: NOW - DAY },
            priority: 'must_do',
            timesPostponed: 6,
        })
        const fixture = buildDb({ docs: baseDocs({ 'p1/tasks/obs': observed, 'p1/tasks/obs2': observed }) })
        await apply(
            fixture,
            request([
                { projectId: 'p1', taskId: 'obs', decision: 'postpone', isObservedTask: true },
                { projectId: 'p1', taskId: 'obs2', decision: 'keep', isObservedTask: true },
            ])
        )
        const stored = fixture.store.get('items/p1/tasks/obs')
        expect(stored.dueDateByObserversIds.u1).toBe(NOW + 3 * DAY)
        expect(stored).toMatchObject({ dueDate: NOW + 10 * DAY, priority: 'must_do', timesPostponed: 6 })
        expect(fixture.store.get('items/p1/tasks/obs2').priority).toBe('must_do')

        const notObserver = buildDb({ docs: baseDocs({ 'p1/tasks/obs': { ...observed, observersIds: ['u3'] } }) })
        await expect(
            apply(
                notObserver,
                request([{ projectId: 'p1', taskId: 'obs', decision: 'postpone', isObservedTask: true }])
            )
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    it('moves open subtasks of a postponed task with it (undoable)', async () => {
        const fixture = buildDb({
            docs: baseDocs({
                'p1/tasks/parent': task({ subtaskIds: ['s1', 's2'] }),
                'p1/tasks/s1': task({ parentId: 'parent', priority: 'should_do' }),
                'p1/tasks/s2': task({ parentId: 'parent', inDone: true }),
            }),
        })
        const result = await apply(
            fixture,
            request([{ projectId: 'p1', taskId: 'parent', decision: 'postpone', isObservedTask: false }])
        )
        expect(result.updatedTaskCount).toBe(2)
        expect(fixture.store.get('items/p1/tasks/s1')).toMatchObject({
            dueDate: NOW + 3 * DAY,
            priority: 'none',
            timesPostponed: 1,
        })
        expect(fixture.store.get('items/p1/tasks/s2').dueDate).toBe(NOW - DAY)
        const subOperation = fixture.store.get('users/u1/undoActions/req-1').operations[1]
        expect(subOperation.requiredCurrentFields).toEqual({ inDone: false, parentId: 'parent' })
    })

    it('is idempotent per requestId', async () => {
        const fixture = buildDb({ docs: baseDocs({ 'p1/tasks/t': task({ timesPostponed: 0 }) }) })
        const data = request([{ projectId: 'p1', taskId: 't', decision: 'postpone', isObservedTask: false }])
        await apply(fixture, data)
        const firstDue = fixture.store.get('items/p1/tasks/t').dueDate
        const again = await apply(fixture, data)
        expect(again).toMatchObject({ duplicate: true, updatedTaskCount: 1 })
        expect(fixture.store.get('items/p1/tasks/t')).toMatchObject({ dueDate: firstDue, timesPostponed: 1 })
    })

    it('refuses a plan reviewed for another local day', async () => {
        const fixture = buildDb({ docs: baseDocs({ 'p1/tasks/t': task() }) })
        await expect(
            apply(
                fixture,
                request([{ projectId: 'p1', taskId: 't', decision: 'keep', isObservedTask: false }], {
                    localDateKey: '2026-11-22',
                })
            )
        ).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    it('refreshes the focus task (conditionally) when the plan postpones it', async () => {
        const fixture = buildDb({
            docs: baseDocs(
                { 'p1/tasks/focus': task({ parentGoalId: 'g1' }) },
                { 'users/u1': { inFocusTaskId: 'focus', inFocusTaskProjectId: 'p1' } }
            ),
        })
        await apply(
            fixture,
            request([{ projectId: 'p1', taskId: 'focus', decision: 'postpone', isObservedTask: false }])
        )
        expect(mockFindAndSetNewFocusTask).toHaveBeenCalledWith('u1', 'p1', 'g1', 'focus', OFFSET, null, {
            expectedCurrentFocusTaskId: 'focus',
        })
    })

    it('Undo restores the plan’s changes, keeps completions and does not stomp later edits', async () => {
        const fixture = buildDb({
            docs: baseDocs({
                'p1/tasks/a': task({ priority: 'none' }),
                'p1/tasks/b': task({ timesPostponed: 2, priority: 'should_do' }),
                'p1/tasks/c': task({ priority: 'none' }),
                'p1/tasks/d': task({ timesPostponed: 0 }),
            }),
        })
        await apply(
            fixture,
            request([
                { projectId: 'p1', taskId: 'a', decision: 'plan', priority: 'must_do', isObservedTask: false },
                { projectId: 'p1', taskId: 'b', decision: 'postpone', isObservedTask: false },
                { projectId: 'p1', taskId: 'c', decision: 'plan', priority: 'could_do', isObservedTask: false },
                { projectId: 'p1', taskId: 'd', decision: 'postpone', isObservedTask: false },
            ])
        )
        // After the apply: a was completed, c's priority was changed again by hand.
        fixture.store.set('items/p1/tasks/a', { ...fixture.store.get('items/p1/tasks/a'), inDone: true, done: true })
        fixture.store.set('items/p1/tasks/c', { ...fixture.store.get('items/p1/tasks/c'), priority: 'must_do' })

        const result = await reverseAction({ db: fixture.db, userId: 'u1', actionId: 'req-1', direction: 'undo' })
        expect(result).toMatchObject({ status: 'undone', skippedOperationCount: 2 })
        expect(fixture.store.get('items/p1/tasks/a')).toMatchObject({ priority: 'must_do', inDone: true })
        expect(fixture.store.get('items/p1/tasks/b')).toMatchObject({
            dueDate: NOW - DAY,
            timesPostponed: 2,
            priority: 'should_do',
        })
        expect(fixture.store.get('items/p1/tasks/c').priority).toBe('must_do')
        expect(fixture.store.get('items/p1/tasks/d')).toMatchObject({
            dueDate: NOW - DAY,
            timesPostponed: 0,
            priority: 'none',
        })
    })

    it('refuses more changes than one undo action can hold', async () => {
        const tasks = {}
        const decisions = []
        for (let index = 0; index < 300; index++) {
            tasks[`p1/tasks/t${index}`] = task({ subtaskIds: [`s${index}`] })
            tasks[`p1/tasks/s${index}`] = task({ parentId: `t${index}` })
            decisions.push({ projectId: 'p1', taskId: `t${index}`, decision: 'postpone', isObservedTask: false })
        }
        const fixture = buildDb({ docs: baseDocs(tasks) })
        await expect(apply(fixture, request(decisions))).rejects.toMatchObject({ code: 'failed-precondition' })
        expect(fixture.writes).toEqual([])
    })
})

describe('loadSomedayHoldTaskKeys', () => {
    it('reads the holds of the latest applied plan', async () => {
        const fixture = buildDb({
            docs: {
                'users/u1/dailyPlans/2026-11-20': { appliedAt: 1, somedayHoldTaskKeys: ['p1:old'] },
                'users/u1/dailyPlans/2026-11-23': { appliedAt: 2, somedayHoldTaskKeys: ['p1:new'] },
            },
        })
        expect([...(await loadSomedayHoldTaskKeys(fixture.db, 'u1'))]).toEqual(['p1:new'])
    })

    it('returns null (fail closed) when the record cannot be read', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        const fixture = buildDb({ failPlanQuery: true })
        expect(await loadSomedayHoldTaskKeys(fixture.db, 'u1')).toBeNull()
    })
})
