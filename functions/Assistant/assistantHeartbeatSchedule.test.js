const moment = require('moment-timezone')

const {
    ACTIVE_USER_WINDOW_MS,
    buildHeartbeatScheduleData,
    calculateNextHeartbeatAt,
    calculateNextHeartbeatAfterOccurrence,
    getHeartbeatScheduleId,
    getHeartbeatScheduleTiming,
    getHeartbeatJitterMs,
    isTimestampInHeartbeatAwakeWindow,
    safelySyncHeartbeatSchedules,
    syncHeartbeatSchedulesForProject,
} = require('./assistantHeartbeatSchedule')

function createMemoryFirestore(initialDocs = {}) {
    const docs = new Map(Object.entries(initialDocs))
    const makeRef = path => ({
        path,
        id: path.split('/').pop(),
        get: async () => makeSnapshot(path),
    })
    const makeSnapshot = path => ({
        id: path.split('/').pop(),
        ref: makeRef(path),
        exists: docs.has(path),
        data: () => ({ ...(docs.get(path) || {}) }),
    })
    const directDocs = path => {
        const prefix = `${path}/`
        return Array.from(docs.keys())
            .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map(makeSnapshot)
    }
    const makeQuery = (path, filters = []) => ({
        where(field, operator, value) {
            expect(operator).toBe('==')
            return makeQuery(path, [...filters, { field, value }])
        },
        async get() {
            const matching = directDocs(path).filter(snapshot =>
                filters.every(filter => snapshot.data()[filter.field] === filter.value)
            )
            return { docs: matching, size: matching.length, empty: matching.length === 0 }
        },
    })
    const db = {
        doc: makeRef,
        collection: path => makeQuery(path),
        getAll: async (...refs) => Promise.all(refs.map(ref => ref.get())),
        batch: () => {
            const operations = []
            return {
                set: (ref, data, options) => operations.push({ type: 'set', ref, data, options }),
                delete: ref => operations.push({ type: 'delete', ref }),
                commit: async () => {
                    operations.forEach(operation => {
                        if (operation.type === 'delete') docs.delete(operation.ref.path)
                        else {
                            const previous = operation.options?.merge ? docs.get(operation.ref.path) || {} : {}
                            docs.set(operation.ref.path, { ...previous, ...operation.data })
                        }
                    })
                },
            }
        },
        __docs: docs,
    }
    return db
}

describe('assistant heartbeat schedule timing', () => {
    const assistant = {
        uid: 'assistant-1',
        heartbeatPrompt: 'Check in.',
        heartbeatChancePercent: 100,
        heartbeatChanceNoReplyPercent: 100,
        heartbeatIntervalMs: 30 * 60 * 1000,
        heartbeatAwakeStart: 8 * 60 * 60 * 1000,
        heartbeatAwakeEnd: 22 * 60 * 60 * 1000,
    }

    test('uses deterministic identities and personalized future times', () => {
        const scheduleId = getHeartbeatScheduleId('project-1', 'assistant-1', 'user-1')
        const timing = getHeartbeatScheduleTiming(assistant, { timezone: 'Europe/Berlin' })
        const afterMs = Date.parse('2026-06-30T06:00:00.000Z')
        const first = calculateNextHeartbeatAt({ afterMs, scheduleId, ...timing })
        const second = calculateNextHeartbeatAt({ afterMs, scheduleId, ...timing })

        expect(first).toBe(second)
        expect(first).toBeGreaterThan(afterMs)
        expect(isTimestampInHeartbeatAwakeWindow(first, timing)).toBe(true)
    })

    test('spreads different users within one configured interval', () => {
        const timing = getHeartbeatScheduleTiming(assistant, { timezone: 'UTC' })
        const afterMs = Date.parse('2026-06-30T08:00:00.000Z')
        const dueTimes = new Set(
            Array.from({ length: 20 }, (_, index) =>
                calculateNextHeartbeatAt({
                    afterMs,
                    scheduleId: getHeartbeatScheduleId('project-1', 'assistant-1', `user-${index}`),
                    ...timing,
                })
            )
        )

        expect(dueTimes.size).toBeGreaterThan(5)
    })

    test('does not make every user immediately overdue when an awake window opens', () => {
        const timing = getHeartbeatScheduleTiming(assistant, { timezone: 'UTC' })
        const awakeStart = Date.parse('2026-06-30T08:00:00.000Z')
        const dueTimes = Array.from({ length: 20 }, (_, index) =>
            calculateNextHeartbeatAt({
                afterMs: awakeStart - 1,
                scheduleId: getHeartbeatScheduleId('project-1', 'assistant-1', `user-${index}`),
                ...timing,
            })
        )

        expect(dueTimes.some(value => value > awakeStart + 5 * 60 * 1000)).toBe(true)
        dueTimes.forEach(value => expect(value).toBeGreaterThanOrEqual(awakeStart))
    })

    test('adds deterministic variance on both sides of every completed interval', () => {
        const timing = getHeartbeatScheduleTiming(
            { ...assistant, heartbeatIntervalMs: 60 * 60 * 1000 },
            { timezone: 'UTC' }
        )
        const previousDueAt = Date.parse('2026-06-30T09:09:00.000Z')
        const scheduleId = getHeartbeatScheduleId('project-1', 'assistant-1', 'user-1')
        const firstCalculation = calculateNextHeartbeatAfterOccurrence({
            afterMs: previousDueAt,
            scheduleId,
            ...timing,
        })
        const secondCalculation = calculateNextHeartbeatAfterOccurrence({
            afterMs: previousDueAt,
            scheduleId,
            ...timing,
        })
        const jitter = firstCalculation - previousDueAt - timing.intervalMs

        expect(firstCalculation).toBe(secondCalculation)
        expect(firstCalculation).not.toBe(Date.parse('2026-06-30T10:09:00.000Z'))
        expect(jitter).toBeGreaterThanOrEqual(-timing.intervalMs * 0.2)
        expect(jitter).toBeLessThanOrEqual(timing.intervalMs * 0.2)
    })

    test('varies the delay between successive occurrences', () => {
        const timing = getHeartbeatScheduleTiming(assistant, { timezone: 'UTC' })
        const scheduleId = getHeartbeatScheduleId('project-1', 'assistant-1', 'user-1')
        const firstDueAt = Date.parse('2026-06-30T09:09:00.000Z')
        const secondDueAt = calculateNextHeartbeatAfterOccurrence({ afterMs: firstDueAt, scheduleId, ...timing })
        const thirdDueAt = calculateNextHeartbeatAfterOccurrence({ afterMs: secondDueAt, scheduleId, ...timing })
        const firstJitter = secondDueAt - firstDueAt - timing.intervalMs
        const secondJitter = thirdDueAt - secondDueAt - timing.intervalMs

        expect(firstJitter).not.toBe(secondJitter)
        expect(secondDueAt - firstDueAt).toBeGreaterThanOrEqual(timing.intervalMs * 0.8)
        expect(secondDueAt - firstDueAt).toBeLessThanOrEqual(timing.intervalMs * 1.2)
        expect(thirdDueAt - secondDueAt).toBeGreaterThanOrEqual(timing.intervalMs * 0.8)
        expect(thirdDueAt - secondDueAt).toBeLessThanOrEqual(timing.intervalMs * 1.2)
    })

    test('produces both early and late occurrence offsets', () => {
        const timing = getHeartbeatScheduleTiming(assistant, { timezone: 'UTC' })
        const scheduleId = getHeartbeatScheduleId('project-1', 'assistant-1', 'user-1')
        const base = Date.parse('2026-06-30T08:00:00.000Z')
        const jitters = Array.from({ length: 50 }, (_, index) =>
            getHeartbeatJitterMs({
                afterMs: base + index * timing.intervalMs,
                scheduleId,
                intervalMs: timing.intervalMs,
            })
        )

        expect(jitters.some(value => value < 0)).toBe(true)
        expect(jitters.some(value => value > 0)).toBe(true)
    })

    test('supports overnight and narrow awake windows', () => {
        const overnight = getHeartbeatScheduleTiming(
            {
                ...assistant,
                heartbeatAwakeStart: 22 * 60 * 60 * 1000,
                heartbeatAwakeEnd: 6 * 60 * 60 * 1000,
            },
            { timezone: 'Europe/Berlin' }
        )
        const narrow = getHeartbeatScheduleTiming(
            {
                ...assistant,
                heartbeatIntervalMs: 60 * 60 * 1000,
                heartbeatAwakeStart: (8 * 60 + 10) * 60 * 1000,
                heartbeatAwakeEnd: (8 * 60 + 20) * 60 * 1000,
            },
            { timezone: 'UTC' }
        )

        const overnightDue = calculateNextHeartbeatAt({
            afterMs: Date.parse('2026-06-30T21:00:00.000Z'),
            scheduleId: 'overnight',
            ...overnight,
        })
        const narrowDue = calculateNextHeartbeatAt({
            afterMs: Date.parse('2026-06-30T08:00:00.000Z'),
            scheduleId: 'narrow',
            ...narrow,
        })

        expect(isTimestampInHeartbeatAwakeWindow(overnightDue, overnight)).toBe(true)
        expect(isTimestampInHeartbeatAwakeWindow(narrowDue, narrow)).toBe(true)
    })

    test('uses named timezone rules across daylight-saving transitions', () => {
        const timing = getHeartbeatScheduleTiming(assistant, { timezone: 'Europe/Berlin' })
        const beforeTransition = Date.parse('2026-03-28T22:00:00.000Z')
        const dueAt = calculateNextHeartbeatAt({
            afterMs: beforeTransition,
            scheduleId: 'dst-user',
            ...timing,
        })
        const localDue = moment(dueAt).tz('Europe/Berlin')

        expect(localDue.hour()).toBeGreaterThanOrEqual(8)
        expect(localDue.hour()).toBeLessThanOrEqual(22)
    })

    test('builds active schedules and preserves an overdue occurrence for dispatch', () => {
        const now = Date.parse('2026-06-30T10:00:00.000Z')
        const existingDueAt = now - 60 * 1000
        const userData = { id: 'user-1', lastLogin: now - ACTIVE_USER_WINDOW_MS + 1000, timezone: 'UTC' }
        const timing = getHeartbeatScheduleTiming(assistant, userData)
        const data = buildHeartbeatScheduleData({
            projectId: 'project-1',
            assistant,
            userId: 'user-1',
            userData,
            existingData: { scheduleHash: timing.scheduleHash, nextHeartbeatAt: existingDueAt, createdAt: 1 },
            now,
        })

        expect(data).not.toBeNull()
        expect(data.nextHeartbeatAt).toBe(existingDueAt)
        expect(data.createdAt).toBe(1)
    })

    test('synchronizes project members and removes disabled schedules', async () => {
        const now = Date.parse('2026-06-30T10:00:00.000Z')
        const db = createMemoryFirestore({
            'projects/project-1': { active: true, userIds: ['user-1', 'user-2'] },
            'users/user-1': { lastLogin: now, timezone: 'UTC' },
            'users/user-2': { lastLogin: now, timezone: 'UTC' },
            'assistants/project-1/items/assistant-1': assistant,
        })

        const enabledResult = await syncHeartbeatSchedulesForProject('project-1', { db, now })
        expect(enabledResult.upserted).toBe(2)
        expect(
            Array.from(db.__docs.keys()).filter(path => path.startsWith('assistantHeartbeatSchedules/'))
        ).toHaveLength(2)

        db.__docs.set('assistants/project-1/items/assistant-1', {
            ...assistant,
            heartbeatChancePercent: 0,
            heartbeatChanceNoReplyPercent: 0,
        })
        const disabledResult = await syncHeartbeatSchedulesForProject('project-1', { db, now: now + 1000 })

        expect(disabledResult.deleted).toBe(2)
        expect(
            Array.from(db.__docs.keys()).filter(path => path.startsWith('assistantHeartbeatSchedules/'))
        ).toHaveLength(0)
    })

    test('removes schedules when a project is deactivated', async () => {
        const now = Date.parse('2026-06-30T10:00:00.000Z')
        const db = createMemoryFirestore({
            'projects/project-1': { active: true, userIds: ['user-1'] },
            'users/user-1': { lastLogin: now, timezone: 'UTC' },
            'assistants/project-1/items/assistant-1': assistant,
        })
        await syncHeartbeatSchedulesForProject('project-1', { db, now })

        const result = await syncHeartbeatSchedulesForProject('project-1', {
            db,
            now: now + 1000,
            projectData: { id: 'project-1', active: false, userIds: ['user-1'] },
        })

        expect(result.deleted).toBe(1)
        expect(
            Array.from(db.__docs.keys()).filter(path => path.startsWith('assistantHeartbeatSchedules/'))
        ).toHaveLength(0)
    })

    test('contains lifecycle synchronization failures for daily repair', async () => {
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
        const result = await safelySyncHeartbeatSchedules(
            async () => {
                throw new Error('index unavailable')
            },
            { source: 'test' }
        )

        expect(result).toEqual({ error: 'index unavailable' })
        expect(errorLog).toHaveBeenCalledWith(
            'Heartbeat schedule synchronization failed; daily reconciliation will retry',
            expect.objectContaining({ source: 'test', error: 'index unavailable' })
        )
        errorLog.mockRestore()
    })
})
