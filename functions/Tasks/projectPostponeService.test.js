const { executeProjectPostpone } = require('./projectPostponeService')
const { FocusTaskService } = require('../shared/FocusTaskService')
jest.mock('../shared/FocusTaskService', () => ({ FocusTaskService: jest.fn() }))

const NOW = Date.UTC(2026, 9, 5, 10)
const TODAY_END = Date.UTC(2026, 9, 5, 21, 59, 59, 999)
const request = { projectId: 'p1', requestId: 'r1', mode: 'date', date: NOW + 86400000, timezoneOffset: 120 }
const task = (id, fields = {}) => ({
    id,
    currentReviewerId: 'u1',
    userId: 'u1',
    inDone: false,
    done: false,
    dueDate: NOW,
    sortIndex: 10,
    timesPostponed: 0,
    priority: 'must_do',
    parentId: null,
    isPublicFor: [0],
    ...fields,
})

function buildDb(tasks = [], { member = true, existingAction = null, user = {} } = {}) {
    const writes = []
    const project = { name: 'Product', userIds: member ? ['u1'] : ['u2'] }
    const snapshot = value => ({ exists: !!value, data: () => value })
    const query = { where: jest.fn(() => query) }
    const db = {
        doc: path => ({ path }),
        collection: path =>
            path === 'users' || path === 'projects'
                ? {
                      doc: () => ({
                          get: async () => snapshot(path === 'users' ? { projectIds: ['p1'], ...user } : project),
                      }),
                  }
                : query,
        runTransaction: async callback =>
            callback({
                get: async ref =>
                    ref === query
                        ? {
                              docs: tasks.map(t => ({
                                  id: t.id,
                                  ref: { path: `items/p1/tasks/${t.id}` },
                                  data: () => t,
                              })),
                          }
                        : snapshot(ref.path.startsWith('projects/') ? project : existingAction),
                update: (ref, data) => writes.push({ path: ref.path, data }),
                set: (ref, data) => writes.push({ path: ref.path, data }),
            }),
    }
    return { db, writes, query }
}
const execute = (fixture, data = request) =>
    executeProjectPostpone({ actorUserId: 'u1', data, db: fixture.db, now: NOW })
const updates = fixture => fixture.writes.filter(w => w.path.startsWith('items/'))
const action = fixture => fixture.writes.find(w => w.path.startsWith('users/')).data

it('selects only the authenticated planning user’s readable open tasks due today or earlier, including goals/subtasks', async () => {
    const fixture = buildDb([
        task('today'),
        task('overdue', { dueDate: NOW - 86400000, parentGoalId: 'g1' }),
        task('subtask', { parentId: 'today' }),
        task('boundary', { dueDate: TODAY_END }),
        task('future', { dueDate: TODAY_END + 1 }),
        task('someday', { dueDate: Number.MAX_SAFE_INTEGER }),
        task('other', { currentReviewerId: 'u2', userIds: ['u1', 'u2'] }),
        task('observed', { currentReviewerId: 'u2', observersIds: ['u1'] }),
        task('done', { done: true }),
        task('in-done', { inDone: true }),
        task('private', { isPublicFor: ['u2'] }),
        task('no-date', { dueDate: undefined }),
    ])
    const result = await execute(fixture, { ...request, targetUserId: 'u2', endOfToday: Number.MAX_SAFE_INTEGER })
    expect(result.updatedTaskCount).toBe(4)
    expect(fixture.query.where).toHaveBeenCalledWith('currentReviewerId', '==', 'u1')
    expect(updates(fixture).map(w => w.path.split('/').pop())).toEqual(['today', 'overdue', 'subtask', 'boundary'])
    expect(action(fixture).operations).toHaveLength(4)
    expect(action(fixture).operations[0]).toMatchObject({
        before: { dueDate: NOW, sortIndex: 10, timesPostponed: 0, priority: 'must_do' },
        after: { dueDate: request.date, timesPostponed: 1, priority: 'none' },
        requiredCurrentFields: { currentReviewerId: 'u1', inDone: false, parentId: null },
    })
    expect(updates(fixture)[2].data).not.toHaveProperty('parentId')
})

it('uses the established per-task auto-postpone dates and saves recurrence/absent fields for undo', async () => {
    const fixture = buildDb([
        task('first', { recurrence: 'weekly' }),
        task('second', { timesPostponed: 1 }),
        task('someday', { timesPostponed: 6 }),
    ])
    await execute(fixture, { ...request, mode: 'auto' })
    expect(updates(fixture).map(w => w.data.dueDate)).toEqual([
        NOW + 3 * 86400000,
        NOW + 7 * 86400000,
        Number.MAX_SAFE_INTEGER,
    ])
    expect(action(fixture).operations[0]).toMatchObject({
        after: { recurrenceOriginalDueDate: NOW },
        beforeMissingFields: ['recurrenceOriginalDueDate'],
    })
})

it('puts all eligible tasks into Someday in one action without touching observer dates', async () => {
    const fixture = buildDb([task('t1', { dueDateByObserversIds: { u2: NOW } }), task('t2')])
    await execute(fixture, { ...request, date: Number.MAX_SAFE_INTEGER })
    expect(updates(fixture)).toHaveLength(2)
    updates(fixture).forEach(w => {
        expect(w.data.dueDate).toBe(Number.MAX_SAFE_INTEGER)
        expect(w.data).not.toHaveProperty('dueDateByObserversIds')
    })
})

it('records missing fields exactly for undo', async () => {
    const t = task('t1')
    delete t.sortIndex
    delete t.timesPostponed
    delete t.priority
    const fixture = buildDb([t])
    await execute(fixture)
    expect(action(fixture).operations[0].beforeMissingFields).toEqual(['sortIndex', 'timesPostponed', 'priority'])
})

it('does not increment postpone counts or reset priority when choosing an earlier date', async () => {
    const fixture = buildDb([task('t1')])
    await execute(fixture, { ...request, date: NOW - 1000 })
    expect(updates(fixture)[0].data).toEqual({ dueDate: NOW - 1000, sortIndex: NOW })
})

it('deduplicates retries without overwriting the original undo entry', async () => {
    const fixture = buildDb([task('t1')], { existingAction: { operations: [{ objectId: 't1' }] } })
    expect(await execute(fixture)).toMatchObject({ duplicate: true, updatedTaskCount: 1 })
    expect(fixture.writes).toEqual([])
})

it('returns a no-op without an empty undo record when no task qualifies', async () => {
    const fixture = buildDb([task('future', { dueDate: request.date })])
    expect(await execute(fixture)).toMatchObject({ updatedTaskCount: 0, actionId: null })
    expect(fixture.writes).toEqual([])
})

it('fails before any write above the shared undo limit', async () => {
    const fixture = buildDb(Array.from({ length: 451 }, (_, i) => task(`t${i}`)))
    await expect(execute(fixture)).rejects.toMatchObject({ code: 'failed-precondition' })
    expect(fixture.writes).toEqual([])
})

it('rejects outsiders and unauthenticated callers', async () => {
    const fixture = buildDb([task('t1')], { member: false })
    await expect(execute(fixture)).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(executeProjectPostpone({ data: request, db: fixture.db })).rejects.toMatchObject({
        code: 'permission-denied',
    })
    expect(fixture.writes).toEqual([])
})

it.each([
    { projectId: '../p1' },
    { requestId: 'bad/id' },
    { date: null },
    { date: '123' },
    { date: -1 },
    { date: Infinity },
    { timezoneOffset: 841 },
    { mode: 'anything' },
])('rejects malformed request %p before writing', async fields => {
    const fixture = buildDb([task('t1')])
    await expect(execute(fixture, { ...request, ...fields })).rejects.toMatchObject({ code: 'invalid-argument' })
    expect(fixture.writes).toEqual([])
})

it('refreshes a postponed focus task conditionally after the bulk commit', async () => {
    const refresh = jest.fn().mockResolvedValue(null)
    FocusTaskService.mockImplementation(() => ({ findAndSetNewFocusTask: refresh }))
    const fixture = buildDb([task('focus', { parentGoalId: 'g1' })], {
        user: { inFocusTaskId: 'focus', inFocusTaskProjectId: 'p1' },
    })
    const result = await execute(fixture)
    expect(refresh).toHaveBeenCalledWith('u1', 'p1', 'g1', 'focus', 120, null, { expectedCurrentFocusTaskId: 'focus' })
    expect(result).toMatchObject({ success: true, updatedTaskCount: 1 })
    expect(result).not.toHaveProperty('postponedFocusTask')
})

it('does not change focus for a Today date and does not report a committed postpone as failed if focus refresh fails', async () => {
    const refresh = jest.fn().mockRejectedValue(new Error('focus unavailable'))
    FocusTaskService.mockImplementation(() => ({ findAndSetNewFocusTask: refresh }))
    const fixture = buildDb([task('focus')], { user: { inFocusTaskId: 'focus', inFocusTaskProjectId: 'p1' } })
    await execute(fixture, { ...request, date: NOW })
    expect(refresh).not.toHaveBeenCalled()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(execute(fixture)).resolves.toMatchObject({ success: true, updatedTaskCount: 1 })
    expect(refresh).toHaveBeenCalledTimes(1)
    warn.mockRestore()
})
