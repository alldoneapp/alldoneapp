const { executeMilestoneDoneTransition, normalizeRequest } = require('./milestoneDoneService')

const snapshot = (exists, data, ref = null) => ({ exists, ref, data: () => data })

function buildDb(initialState) {
    const state = new Map(Object.entries(initialState))
    const writes = []
    let generatedId = 0

    const ref = path => ({
        path,
        id: path.split('/').pop(),
        get: async () => snapshot(state.has(path), state.get(path), ref(path)),
    })

    class Query {
        constructor(path, filters = [], order = null) {
            this.path = path
            this.filters = filters
            this.order = order
        }

        where(field, operator, value) {
            return new Query(this.path, [...this.filters, { field, operator, value }], this.order)
        }

        orderBy(field, direction = 'asc') {
            return new Query(this.path, this.filters, { field, direction })
        }
    }

    const matches = (data, filter) => {
        const value = data[filter.field]
        if (filter.operator === '==') return value === filter.value
        if (filter.operator === '>') return value > filter.value
        if (filter.operator === 'array-contains') return Array.isArray(value) && value.includes(filter.value)
        throw new Error(`Unsupported operator ${filter.operator}`)
    }

    const querySnapshot = query => {
        const prefix = `${query.path}/`
        let docs = Array.from(state.entries())
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
            .map(([path, data]) => ({ id: path.slice(prefix.length), ref: ref(path), data: () => data }))
            .filter(doc => query.filters.every(filter => matches(doc.data(), filter)))
        if (query.order) {
            const direction = query.order.direction === 'desc' ? -1 : 1
            docs = docs.sort((a, b) => (a.data()[query.order.field] - b.data()[query.order.field]) * direction)
        }
        return { docs }
    }

    const transaction = {
        get: jest.fn(async target =>
            target instanceof Query
                ? querySnapshot(target)
                : snapshot(state.has(target.path), state.get(target.path), target)
        ),
        update: jest.fn((target, data) => {
            writes.push({ type: 'update', path: target.path, data })
            state.set(target.path, { ...(state.get(target.path) || {}), ...data })
        }),
        set: jest.fn((target, data) => {
            writes.push({ type: 'set', path: target.path, data })
            state.set(target.path, data)
        }),
        delete: jest.fn(target => {
            writes.push({ type: 'delete', path: target.path })
            state.delete(target.path)
        }),
    }

    const db = {
        doc: jest.fn(path => ref(path)),
        collection: jest.fn(path => {
            const query = new Query(path)
            query.doc = id => ref(`${path}/${id || `generated-${++generatedId}`}`)
            return query
        }),
        runTransaction: jest.fn(handler => handler(transaction)),
    }

    return { db, state, transaction, writes }
}

const baseState = {
    'users/user-1': { projectIds: ['project-1'] },
    'projects/project-1': { userIds: ['user-1', 'user-2'] },
}

describe('milestoneDoneService', () => {
    test('moves milestone bookkeeping and incomplete goals through one server transaction', async () => {
        const { db, state } = buildDb({
            ...baseState,
            'goalsMilestones/project-1/milestonesItems/milestone-1': {
                date: 100,
                done: false,
                ownerId: 'ALL_USERS',
                milestoneType: 'fixed',
            },
            'goalsMilestones/project-1/milestonesItems/milestone-2': {
                date: 200,
                done: false,
                ownerId: 'ALL_USERS',
                milestoneType: 'fixed',
            },
            'goals/project-1/items/private-goal': {
                isPublicFor: ['user-2'],
                ownerId: 'ALL_USERS',
                scheduleMode: 'fixed',
                startingMilestoneDate: 100,
                completionMilestoneDate: 100,
                assigneesIds: ['user-2'],
                progress: 50,
                parentDoneMilestoneIds: [],
                progressByDoneMilestone: {},
                dateByDoneMilestone: {},
                sortIndexByMilestone: {},
            },
        })

        const result = await executeMilestoneDoneTransition({
            actorUserId: 'user-1',
            data: { projectId: 'project-1', milestoneId: 'milestone-1', targetDone: true },
            db,
            now: 1234,
            createSortIndex: () => 999,
        })

        expect(result).toMatchObject({ success: true, done: true, updatedGoalCount: 1, duplicate: false })
        expect(state.get('goalsMilestones/project-1/milestonesItems/milestone-1')).toMatchObject({
            done: true,
            doneDate: 1234,
        })
        expect(state.get('goals/project-1/items/private-goal')).toMatchObject({
            completionMilestoneDate: 200,
            parentDoneMilestoneIds: ['milestone-1'],
            progressByDoneMilestone: { 'milestone-1': { progress: 50, doneDate: 1234 } },
            dateByDoneMilestone: { 'milestone-1': 100 },
            sortIndexByMilestone: { 'milestone-2': 999 },
            lastEditorId: 'user-1',
        })
    })

    test('is idempotent when a retried request already reached its target state', async () => {
        const { db, writes } = buildDb({
            ...baseState,
            'goalsMilestones/project-1/milestonesItems/milestone-1': {
                date: 100,
                done: true,
                ownerId: 'ALL_USERS',
                milestoneType: 'fixed',
            },
        })

        const result = await executeMilestoneDoneTransition({
            actorUserId: 'user-1',
            data: { projectId: 'project-1', milestoneId: 'milestone-1', targetDone: true },
            db,
        })

        expect(result).toMatchObject({ success: true, duplicate: true, done: true, updatedGoalCount: 0 })
        expect(writes).toEqual([])
    })

    test('creates the next automatic milestone before rolling an incomplete dynamic goal', async () => {
        const { db, state, writes } = buildDb({
            ...baseState,
            'projects/project-1': {
                userIds: ['user-1', 'user-2'],
                goalMilestonesConfig: {
                    mode: 'linear',
                    cadence: 'monthly',
                    timezone: 'UTC',
                    cadenceStartDate: Date.UTC(2026, 0, 1),
                    futureMilestonesToCreate: 2,
                },
            },
            'goalsMilestones/project-1/milestonesItems/milestone-linear': {
                date: Date.UTC(2026, 0, 31, 12),
                periodEndDate: Date.UTC(2026, 0, 31, 23, 59, 59, 999),
                done: false,
                ownerId: 'ALL_USERS',
                milestoneType: 'linear',
            },
            'goals/project-1/items/dynamic-goal': {
                isPublicFor: [0],
                ownerId: 'ALL_USERS',
                scheduleMode: 'dynamic',
                startingMilestoneDate: Date.UTC(2026, 0, 31, 12),
                completionMilestoneDate: Date.UTC(2026, 0, 31, 12),
                assigneesIds: ['user-1'],
                progress: 'DYNAMIC_PERCENT',
                dynamicProgress: 40,
                parentDoneMilestoneIds: [],
                progressByDoneMilestone: {},
                dateByDoneMilestone: {},
                sortIndexByMilestone: {},
            },
        })

        await executeMilestoneDoneTransition({
            actorUserId: 'user-1',
            data: { projectId: 'project-1', milestoneId: 'milestone-linear', targetDone: true },
            db,
            now: Date.UTC(2026, 1, 1),
            createSortIndex: () => 777,
        })

        const createdMilestone = writes.find(
            write => write.type === 'set' && write.path.includes('/milestonesItems/generated-')
        )
        expect(createdMilestone.data).toMatchObject({ done: false, milestoneType: 'linear', ownerId: 'ALL_USERS' })
        const updatedGoal = state.get('goals/project-1/items/dynamic-goal')
        expect(updatedGoal.completionMilestoneDate).toBe(createdMilestone.data.date)
        expect(updatedGoal.completionMilestoneDate).not.toBe(Number.MAX_SAFE_INTEGER)
        expect(updatedGoal.sortIndexByMilestone).toEqual({ 'generated-1': 777 })
    })

    test('reopens a done milestone and restores a goal without another open milestone', async () => {
        const { db, state } = buildDb({
            ...baseState,
            'goalsMilestones/project-1/milestonesItems/milestone-1': {
                date: 100,
                done: true,
                ownerId: 'ALL_USERS',
                milestoneType: 'fixed',
            },
            'goals/project-1/items/goal-1': {
                isPublicFor: [0],
                ownerId: 'ALL_USERS',
                scheduleMode: 'fixed',
                startingMilestoneDate: Number.MAX_SAFE_INTEGER,
                completionMilestoneDate: Number.MAX_SAFE_INTEGER,
                assigneesIds: ['user-1'],
                progress: 100,
                parentDoneMilestoneIds: ['milestone-1'],
                progressByDoneMilestone: { 'milestone-1': { progress: 100, doneDate: 900 } },
                dateByDoneMilestone: { 'milestone-1': 100 },
                sortIndexByMilestone: {},
            },
        })

        const result = await executeMilestoneDoneTransition({
            actorUserId: 'user-1',
            data: { projectId: 'project-1', milestoneId: 'milestone-1', targetDone: false },
            db,
            now: 1234,
            createSortIndex: () => 888,
        })

        expect(result).toMatchObject({ success: true, done: false, updatedGoalCount: 1 })
        expect(state.get('goalsMilestones/project-1/milestonesItems/milestone-1').done).toBe(false)
        expect(state.get('goals/project-1/items/goal-1')).toMatchObject({
            progress: 80,
            startingMilestoneDate: 100,
            completionMilestoneDate: 100,
            parentDoneMilestoneIds: [],
            progressByDoneMilestone: {},
            dateByDoneMilestone: {},
            sortIndexByMilestone: { 'milestone-1': 888 },
        })
    })

    test('rejects callers who are not project members', async () => {
        const { db, writes } = buildDb({
            ...baseState,
            'users/outsider': { projectIds: [] },
            'goalsMilestones/project-1/milestonesItems/milestone-1': {
                date: 100,
                done: false,
                ownerId: 'ALL_USERS',
            },
        })

        await expect(
            executeMilestoneDoneTransition({
                actorUserId: 'outsider',
                data: { projectId: 'project-1', milestoneId: 'milestone-1', targetDone: true },
                db,
            })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(writes).toEqual([])
    })

    test('validates target state instead of accepting an arbitrary update payload', () => {
        expect(() => normalizeRequest({ projectId: 'project-1', milestoneId: 'milestone-1' })).toThrow(
            'targetDone must be a boolean'
        )
    })
})
