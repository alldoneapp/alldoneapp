const moment = require('moment-timezone')

const mockDb = { current: null }

jest.mock('firebase-admin', () => ({
    firestore: Object.assign(
        jest.fn(() => mockDb.current),
        {
            FieldValue: {
                arrayUnion: (...values) => ({ __op: 'arrayUnion', values }),
                arrayRemove: (...values) => ({ __op: 'arrayRemove', values }),
                delete: () => ({ __op: 'delete' }),
            },
        }
    ),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    ALL_USERS: 'ALL_USERS',
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    DYNAMIC_PERCENT: 'DYNAMIC_PERCENT',
    generateSortIndex: jest.fn(() => 1000),
}))

const {
    GOAL_MILESTONES_CADENCE_WEEKLY,
    GOAL_MILESTONES_MODE_LINEAR,
    GOAL_SCHEDULE_MODE_DYNAMIC,
    MILESTONE_TYPE_FIXED,
    MILESTONE_TYPE_LINEAR,
    getLinearMilestonePeriod,
} = require('../shared/goalMilestonesHelper')
const { processLinearProject } = require('./linearGoalMilestones')

function getNestedValue(data, field) {
    return field.split('.').reduce((value, key) => (value ? value[key] : undefined), data)
}

function setNestedValue(data, field, value) {
    const parts = field.split('.')
    let cursor = data
    parts.slice(0, -1).forEach(part => {
        if (!cursor[part]) cursor[part] = {}
        cursor = cursor[part]
    })
    const last = parts[parts.length - 1]
    if (value && value.__op === 'arrayUnion') {
        const existing = Array.isArray(cursor[last]) ? cursor[last] : []
        cursor[last] = Array.from(new Set([...existing, ...value.values]))
    } else if (value && value.__op === 'arrayRemove') {
        const existing = Array.isArray(cursor[last]) ? cursor[last] : []
        cursor[last] = existing.filter(item => !value.values.includes(item))
    } else if (value && value.__op === 'delete') {
        delete cursor[last]
    } else {
        cursor[last] = value
    }
}

function deepMerge(target, source) {
    Object.entries(source).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && !value.__op) {
            target[key] = deepMerge(target[key] || {}, value)
        } else {
            target[key] = value
        }
    })
    return target
}

class FakeDoc {
    constructor(id, data) {
        this.id = id
        this._data = data
    }

    data() {
        return this._data
    }
}

class FakeDocRef {
    constructor(db, collectionPath, id) {
        this.db = db
        this.collectionPath = collectionPath
        this.id = id || db.nextId()
        this.path = `${collectionPath}/${this.id}`
    }

    async set(data, options = {}) {
        if (!this.db.data[this.collectionPath]) this.db.data[this.collectionPath] = {}
        if (options.merge) {
            this.db.data[this.collectionPath][this.id] = deepMerge(
                this.db.data[this.collectionPath][this.id] || {},
                JSON.parse(JSON.stringify(data))
            )
        } else {
            this.db.data[this.collectionPath][this.id] = JSON.parse(JSON.stringify(data))
        }
    }

    async update(patch) {
        const current = this.db.data[this.collectionPath][this.id]
        Object.entries(patch).forEach(([field, value]) => setNestedValue(current, field, value))
    }

    async delete() {
        delete this.db.data[this.collectionPath][this.id]
    }
}

class FakeCollection {
    constructor(db, path, filters = [], limitValue = null) {
        this.db = db
        this.path = path.replace(/^\//, '')
        this.filters = filters
        this.limitValue = limitValue
    }

    doc(id) {
        return new FakeDocRef(this.db, this.path, id)
    }

    where(field, operator, value) {
        return new FakeCollection(this.db, this.path, [...this.filters, { field, operator, value }], this.limitValue)
    }

    limit(limitValue) {
        return new FakeCollection(this.db, this.path, this.filters, limitValue)
    }

    async get() {
        let docs = Object.entries(this.db.data[this.path] || {}).filter(([, data]) =>
            this.filters.every(filter => {
                const value = getNestedValue(data, filter.field)
                if (filter.operator === '==') return value === filter.value
                throw new Error(`Unsupported operator: ${filter.operator}`)
            })
        )
        if (this.limitValue) docs = docs.slice(0, this.limitValue)
        return { docs: docs.map(([id, data]) => new FakeDoc(id, data)) }
    }
}

class FakeDb {
    constructor(data) {
        this.data = data
        this.idCounter = 1
    }

    nextId() {
        return `generated-${this.idCounter++}`
    }

    collection(path) {
        return new FakeCollection(this, path)
    }
}

describe('linearGoalMilestones', () => {
    test('rolls unfinished dynamic goals, snapshots completed dynamic goals, and preserves fixed goals', async () => {
        const cadenceStartDate = moment.tz('2026-01-01 12:00', 'UTC').valueOf()
        const closingPeriod = getLinearMilestonePeriod(moment.tz('2026-01-06 12:00', 'UTC').valueOf(), {
            mode: GOAL_MILESTONES_MODE_LINEAR,
            cadence: GOAL_MILESTONES_CADENCE_WEEKLY,
            timezone: 'UTC',
            cadenceStartDate,
        })
        const now = moment.tz('2026-01-12 01:00', 'UTC').valueOf()

        const db = new FakeDb({
            'goalsMilestones/project-1/milestonesItems': {
                'linear-old': {
                    ...closingPeriod,
                    extendedName: 'Old week',
                    done: false,
                    ownerId: 'ALL_USERS',
                    milestoneType: MILESTONE_TYPE_LINEAR,
                    assigneesCapacityDates: {},
                    doneDate: closingPeriod.date,
                    hasStar: '#FFFFFF',
                },
            },
            'goals/project-1/items': {
                'dynamic-open': {
                    completionMilestoneDate: closingPeriod.date,
                    startingMilestoneDate: closingPeriod.date,
                    ownerId: 'ALL_USERS',
                    scheduleMode: GOAL_SCHEDULE_MODE_DYNAMIC,
                    assigneesIds: ['user-1'],
                    assigneesReminderDate: { 'user-1': closingPeriod.date },
                    progress: 40,
                    dynamicProgress: 0,
                    parentDoneMilestoneIds: [],
                    progressByDoneMilestone: {},
                    dateByDoneMilestone: {},
                    sortIndexByMilestone: {},
                },
                'dynamic-complete': {
                    completionMilestoneDate: closingPeriod.date,
                    startingMilestoneDate: closingPeriod.date,
                    ownerId: 'ALL_USERS',
                    scheduleMode: GOAL_SCHEDULE_MODE_DYNAMIC,
                    assigneesIds: ['user-1'],
                    assigneesReminderDate: { 'user-1': closingPeriod.date },
                    progress: 100,
                    dynamicProgress: 100,
                    parentDoneMilestoneIds: [],
                    progressByDoneMilestone: {},
                    dateByDoneMilestone: {},
                    sortIndexByMilestone: {},
                },
                'fixed-legacy': {
                    completionMilestoneDate: closingPeriod.date,
                    startingMilestoneDate: closingPeriod.date,
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    assigneesReminderDate: { 'user-1': closingPeriod.date },
                    progress: 0,
                    dynamicProgress: 0,
                    parentDoneMilestoneIds: [],
                    progressByDoneMilestone: {},
                    dateByDoneMilestone: {},
                    sortIndexByMilestone: {},
                },
            },
        })
        mockDb.current = db

        const result = await processLinearProject(
            'project-1',
            {
                active: true,
                goalMilestonesConfig: {
                    mode: GOAL_MILESTONES_MODE_LINEAR,
                    cadence: GOAL_MILESTONES_CADENCE_WEEKLY,
                    timezone: 'UTC',
                    cadenceStartDate,
                    futureMilestonesToCreate: 3,
                },
            },
            now
        )

        const milestones = db.data['goalsMilestones/project-1/milestonesItems']
        const goals = db.data['goals/project-1/items']
        const nextDate = getLinearMilestonePeriod(now, {
            mode: GOAL_MILESTONES_MODE_LINEAR,
            cadence: GOAL_MILESTONES_CADENCE_WEEKLY,
            timezone: 'UTC',
            cadenceStartDate,
        }).date
        const fixedMilestones = Object.values(milestones).filter(
            milestone => milestone.milestoneType === MILESTONE_TYPE_FIXED && milestone.done === false
        )

        expect(result.closedMilestones).toBe(1)
        expect(result.rolledGoals).toBe(1)
        expect(milestones['linear-old'].done).toBe(true)
        expect(fixedMilestones).toHaveLength(1)
        expect(fixedMilestones[0].date).toBe(closingPeriod.date)
        expect(goals['dynamic-open'].completionMilestoneDate).toBe(nextDate)
        expect(goals['dynamic-open'].parentDoneMilestoneIds).toEqual(['linear-old'])
        expect(goals['dynamic-complete'].completionMilestoneDate).toBe(closingPeriod.date)
        expect(goals['dynamic-complete'].parentDoneMilestoneIds).toEqual(['linear-old'])
        expect(goals['fixed-legacy'].completionMilestoneDate).toBe(closingPeriod.date)
        expect(Object.keys(goals['fixed-legacy'].sortIndexByMilestone)).toHaveLength(1)

        await processLinearProject(
            'project-1',
            {
                active: true,
                goalMilestonesConfig: {
                    mode: GOAL_MILESTONES_MODE_LINEAR,
                    cadence: GOAL_MILESTONES_CADENCE_WEEKLY,
                    timezone: 'UTC',
                    cadenceStartDate,
                    futureMilestonesToCreate: 3,
                },
            },
            now
        )

        const doneLinearMilestones = Object.values(milestones).filter(
            milestone => milestone.milestoneType === MILESTONE_TYPE_LINEAR && milestone.done === true
        )
        const fixedMilestonesAfterSecondRun = Object.values(milestones).filter(
            milestone => milestone.milestoneType === MILESTONE_TYPE_FIXED && milestone.done === false
        )

        expect(doneLinearMilestones).toHaveLength(1)
        expect(fixedMilestonesAfterSecondRun).toHaveLength(1)
        expect(goals['dynamic-open'].parentDoneMilestoneIds).toEqual(['linear-old'])
    })
})
