jest.mock('../Utils/HelperFunctionsCloud', () => ({
    ESTIMATION_16_HOURS: 960,
    ESTIMATION_POINTS_VALUES: { 0: 0, 15: 1, 30: 2, 60: 3, 120: 5, 240: 8, 480: 13, 960: 21 },
}))

const {
    getStatisticsDay,
    reconcileDayRateStatistics,
    reconcileDayRateStatisticsOnWrite,
} = require('./dayRateStatistics')

const projectId = 'project-1'
const userId = 'user-1'
const dateKey = '17092026'
const statsPath = `statistics/${projectId}/${userId}/${dateKey}`
const anchorPath = `items/${projectId}/tasks/dayRateTimeLog_${userId}_20260917`
const completed = Date.parse('2026-09-17T12:00:00Z')
const task = (minutes, calendar = false, overrides = {}) => ({
    userId,
    readerIds: [userId],
    done: true,
    inDone: true,
    completed,
    parentId: null,
    estimations: { '-1': minutes },
    calendarData: calendar ? { start: { dateTime: '2026-09-17T14:00:00+02:00' } } : null,
    ...overrides,
})

function fixture({ doneTime = 510, tasks, anchorOverrides = {}, user = { preferredTimezone: 'Europe/Berlin' } } = {}) {
    const anchor = task(330, false, {
        completed: Date.parse('2026-09-16T22:00:00Z'),
        genericData: { type: 'dayRateTimeLog', day: '20260917', manual: false, cappedMinutes: 0 },
        ...anchorOverrides,
    })
    const documents = {
        [`projects/${projectId}`]: {
            userIds: [userId],
            dayRateTimeLog: { enabled: true, targetMinutes: 480, triggerTasks: 5 },
        },
        [`users/${userId}`]: user,
        [statsPath]: { doneTime, donePoints: 19, doneTasks: 18, xp: 6800, gold: 16, timestamp: completed },
        [anchorPath]: anchor,
    }
    const realTasks = tasks || [task(30, true), task(30, true), task(60, true), task(30, true), task(0)]
    const filters = []
    const query = {
        where: jest.fn((...args) => {
            filters.push(args)
            return query
        }),
        orderBy: jest.fn(() => query),
    }
    const snapshot = path => ({ exists: !!documents[path], data: () => documents[path] })
    const transaction = {
        get: jest.fn(async ref => {
            if (ref !== query) return snapshot(ref.path)
            return {
                docs: [...realTasks, documents[anchorPath]]
                    .filter(Boolean)
                    .filter(t =>
                        filters.every(([field, operator, value]) => {
                            if (operator === '==') return t[field] === value
                            if (operator === '>=') return t[field] >= value
                            if (operator === '<=') return t[field] <= value
                            return t[field]?.includes(value)
                        })
                    )
                    .map(t => ({
                        ref: { parent: { path: `items/${t.projectId || projectId}/tasks` } },
                        data: () => t,
                    })),
            }
        }),
        update: jest.fn((ref, changes) => {
            for (const [field, value] of Object.entries(changes)) {
                const segments = field.split('.')
                const leaf = segments.pop()
                let destination = documents[ref.path]
                for (const segment of segments) destination = destination[segment]
                destination[leaf] = value
            }
        }),
    }
    const db = {
        doc: path => ({ path }),
        collectionGroup: jest.fn(() => {
            filters.length = 0
            return query
        }),
        runTransaction: jest.fn(callback => callback(transaction)),
    }
    return { db, documents, transaction, query, args: { db, projectId, userId, dateKey } }
}

test('repairs September 17: 150 meeting minutes + 330 top-up = 480, despite 510 saved minutes', async () => {
    const f = fixture()
    const before = { ...f.documents[statsPath] }
    await expect(reconcileDayRateStatistics(f.args)).resolves.toMatchObject({
        updated: true,
        previousDoneTime: 510,
        doneTime: 480,
    })
    expect(f.documents[statsPath]).toEqual({ ...before, doneTime: 480, donePoints: 17 })
    expect(f.documents[anchorPath].estimations['-1']).toBe(330)
    expect(f.transaction.update).toHaveBeenCalledTimes(1)
})

test('a repeated repair and its own statistics event perform no further writes', async () => {
    const f = fixture()
    await reconcileDayRateStatistics(f.args)
    f.transaction.update.mockClear()
    await expect(
        reconcileDayRateStatisticsOnWrite({ ...f.args, before: { doneTime: 510 }, after: { doneTime: 480 } })
    ).resolves.toEqual({ updated: false, doneTime: 480 })
    expect(f.transaction.update).not.toHaveBeenCalled()
})

test('an old event repairs the latest stored value, not its obsolete event total', async () => {
    const f = fixture({ doneTime: 540 })
    await reconcileDayRateStatisticsOnWrite({ ...f.args, before: { doneTime: 480 }, after: { doneTime: 510 } })
    expect(f.documents[statsPath].doneTime).toBe(480)
})

test('late calendar duration changes reduce the top-up instead of inflating the day', async () => {
    const f = fixture({ tasks: [task(180, true), task(0), task(0), task(0), task(0)] })
    await reconcileDayRateStatistics(f.args)
    expect(f.documents[statsPath].doneTime).toBe(480)
    expect(f.documents[anchorPath].estimations['-1']).toBe(300)
})

test('includes a newly moved meeting before its reader projection finishes and excludes other projects', async () => {
    const f = fixture({
        doneTime: 540,
        tasks: [
            task(210, true, { readerIds: undefined }),
            task(600, false, { projectId: 'other-project' }),
            task(0),
            task(0),
            task(0),
            task(0),
        ],
    })
    await reconcileDayRateStatistics(f.args)
    expect(f.documents[statsPath].doneTime).toBe(480)
    expect(f.documents[anchorPath].estimations['-1']).toBe(270)
})

test('reopening a meeting increases the top-up on a qualifying worked day', async () => {
    const f = fixture({ doneTime: 450, tasks: [task(120, true), task(0), task(0), task(0), task(0)] })
    await reconcileDayRateStatistics(f.args)
    expect(f.documents[statsPath].doneTime).toBe(480)
    expect(f.documents[anchorPath].estimations['-1']).toBe(360)
})

test('preserves ten hand-logged hours and removes only calendar time and the previous top-up', async () => {
    const f = fixture({ doneTime: 1080, tasks: [task(600), task(150, true)] })
    await reconcileDayRateStatistics(f.args)
    expect(f.documents[statsPath].doneTime).toBe(600)
    expect(f.documents[anchorPath].estimations['-1']).toBe(0)
    expect(f.documents[anchorPath].genericData.cappedMinutes).toBe(150)
})

test('restores real task time when hand-logged time prevents automatic top-up', async () => {
    const f = fixture({ doneTime: 600, tasks: [task(120), task(150, true), task(0), task(0), task(0)] })
    await reconcileDayRateStatistics(f.args)
    expect(f.documents[statsPath].doneTime).toBe(270)
    expect(f.documents[anchorPath].estimations['-1']).toBe(0)
})

test('manual worked-day marking still permits a top-up below the five-task trigger', async () => {
    const f = fixture({
        tasks: [task(150, true)],
        anchorOverrides: { genericData: { type: 'dayRateTimeLog', day: '20260917', manual: true, cappedMinutes: 0 } },
    })
    await reconcileDayRateStatistics(f.args)
    expect(f.documents[statsPath].doneTime).toBe(480)
    expect(f.documents[anchorPath].genericData.manual).toBe(true)
})

test('ignores all-day events, subtasks, unfinished tasks and meetings outside the local day', async () => {
    const f = fixture({
        tasks: [
            task(150, true),
            task(480, true, { calendarData: { start: { date: '2026-09-17' } } }),
            task(600, false, { parentId: 'parent' }),
            task(300, true, { done: false }),
            task(180, true, { completed: Date.parse('2026-09-17T22:00:00Z') }),
            task(180, true, { completed: Date.parse('2026-09-16T21:59:59Z') }),
            task(0),
            task(0),
            task(0),
        ],
    })
    await reconcileDayRateStatistics(f.args)
    expect(f.documents[statsPath].doneTime).toBe(480)
    expect(f.documents[anchorPath].estimations['-1']).toBe(330)
})

test.each(['disabled', 'nonmember', 'missing anchor', 'missing statistics', 'unknown timezone'])(
    '%s is untouched',
    async reason => {
        const f = fixture()
        if (reason === 'disabled') f.documents[`projects/${projectId}`].dayRateTimeLog.enabled = false
        if (reason === 'nonmember') f.documents[`projects/${projectId}`].userIds = []
        if (reason === 'missing anchor') delete f.documents[anchorPath]
        if (reason === 'missing statistics') delete f.documents[statsPath]
        if (reason === 'unknown timezone') f.documents[`users/${userId}`] = {}
        await expect(reconcileDayRateStatistics(f.args)).resolves.toEqual({ updated: false })
        expect(f.transaction.update).not.toHaveBeenCalled()
    }
)

test('XP-only writes and deletions do not start reconciliation', async () => {
    const f = fixture()
    for (const after of [undefined, { doneTime: 510, xp: 9000 }]) {
        await reconcileDayRateStatisticsOnWrite({ ...f.args, before: { doneTime: 510 }, after })
    }
    expect(f.db.runTransaction).not.toHaveBeenCalled()
})

test('uses the named timezone for DST and accepts legacy hour/minute offsets', () => {
    expect(getStatisticsDay('17092026', { preferredTimezone: 'Europe/Berlin' }).toISOString()).toBe(
        '2026-09-16T22:00:00.000Z'
    )
    expect(getStatisticsDay('17122026', { preferredTimezone: 'Europe/Berlin' }).toISOString()).toBe(
        '2026-12-16T23:00:00.000Z'
    )
    expect(getStatisticsDay('17092026', { timezone: 2 }).toISOString()).toBe('2026-09-16T22:00:00.000Z')
    expect(getStatisticsDay('17092026', { timezoneMinutes: 120 }).toISOString()).toBe('2026-09-16T22:00:00.000Z')
    expect(getStatisticsDay('32132026', { timezone: 2 }).isValid()).toBe(false)
})
