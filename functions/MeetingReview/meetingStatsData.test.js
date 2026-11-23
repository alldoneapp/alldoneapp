'use strict'

const { getMeetingStatsData, MAX_RANGE_MS } = require('./meetingStatsData')

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const FROM = Date.UTC(2026, 10, 23)
const TO = FROM + 7 * DAY

const getPath = (data, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), data)

const matches = (data, { field, op, value }) => {
    const actual = getPath(data, field)
    switch (op) {
        case '==':
            return actual === value
        case '>=':
            return typeof actual === 'number' && actual >= value
        case '<':
            return typeof actual === 'number' && actual < value
        case 'array-contains':
            return Array.isArray(actual) && actual.includes(value)
        default:
            throw new Error(`unsupported op ${op}`)
    }
}

// A tiny Firestore double that evaluates the filters the module really sends, so a wrong filter
// fails here instead of passing against a stub that ignores it.
const createDb = ({ users = {}, projects = {}, tasksByProject = {}, failingProjects = [] }) => {
    const queries = []
    const query = (path, filters = []) => ({
        where: (field, op, value) => query(path, [...filters, { field, op, value }]),
        limit: () => query(path, filters),
        get: async () => {
            queries.push({ path, filters })
            const projectId = path.split('/')[1]
            if (failingProjects.includes(projectId)) throw new Error('boom')
            const docs = (tasksByProject[projectId] || [])
                .filter(task => filters.every(filter => matches(task, filter)))
                .map(task => ({ id: task.id, data: () => task }))
            return { docs }
        },
    })
    return {
        queries,
        collection: path => {
            if (path === 'users' || path === 'projects') {
                const source = path === 'users' ? users : projects
                return {
                    doc: id => ({
                        get: async () => ({ exists: !!source[id], data: () => source[id] }),
                    }),
                }
            }
            return query(path)
        },
    }
}

const calendarTask = (id, startMs, extra = {}) => ({
    id,
    userId: 'me',
    name: id,
    done: false,
    inDone: false,
    isPublicFor: [0, 'me'],
    dueDate: startMs - HOUR,
    calendarData: { startMs, endMs: startMs + HOUR, start: {}, end: {}, email: 'secret@company.com', link: 'x' },
    ...extra,
})

describe('getMeetingStatsData', () => {
    const baseFixture = () => ({
        users: { me: { projectIds: ['shared', 'notMember'] } },
        projects: { shared: { userIds: ['me', 'colleague'] }, notMember: { userIds: ['other'] } },
        tasksByProject: {
            shared: [
                calendarTask('mine', FROM + 10 * HOUR),
                calendarTask('colleagues', FROM + 11 * HOUR, {
                    userId: 'colleague',
                    isPublicFor: [0, 'colleague', 'me'],
                }),
                calendarTask('outside', TO + 2 * HOUR),
                calendarTask('legacy', 0, {
                    calendarData: {
                        start: { dateTime: new Date(FROM + 30 * HOUR).toISOString() },
                        end: { dateTime: new Date(FROM + 31 * HOUR).toISOString() },
                    },
                    dueDate: FROM + 29 * HOUR,
                    done: true,
                    inDone: true,
                }),
            ],
            notMember: [calendarTask('foreign', FROM + 10 * HOUR, { userId: 'me' })],
        },
    })

    it("returns only the caller's own calendar tasks in member projects, inside the period", async () => {
        const db = createDb(baseFixture())
        const result = await getMeetingStatsData(db, 'me', { fromMs: FROM, toMs: TO })
        expect(result.tasks.map(task => task.id).sort()).toEqual(['legacy', 'mine'])
        expect(result.failedProjectIds).toEqual([])
        // the membership authority is projects/{pid}.userIds, not users/{uid}.projectIds
        expect(db.queries.some(item => item.path === 'items/notMember/tasks')).toBe(false)
    })

    it('does not return addresses or links of the calendar', async () => {
        const result = await getMeetingStatsData(createDb(baseFixture()), 'me', { fromMs: FROM, toMs: TO })
        const mine = result.tasks.find(task => task.id === 'mine')
        expect(mine.calendarData).not.toHaveProperty('email')
        expect(mine.calendarData).not.toHaveProperty('link')
    })

    it('rejects missing auth, invalid and too long periods', async () => {
        const db = createDb(baseFixture())
        await expect(getMeetingStatsData(db, '', { fromMs: FROM, toMs: TO })).rejects.toMatchObject({
            code: 'unauthenticated',
        })
        await expect(getMeetingStatsData(db, 'me', { fromMs: TO, toMs: FROM })).rejects.toMatchObject({
            code: 'invalid-argument',
        })
        await expect(
            getMeetingStatsData(db, 'me', { fromMs: FROM, toMs: FROM + MAX_RANGE_MS + 1 })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    it('reports a project it could not read instead of silently shrinking the total', async () => {
        const fixture = baseFixture()
        const db = createDb({ ...fixture, failingProjects: ['shared'] })
        const result = await getMeetingStatsData(db, 'me', { fromMs: FROM, toMs: TO })
        expect(result.failedProjectIds).toEqual(['shared'])
        expect(result.tasks).toEqual([])
    })
})
