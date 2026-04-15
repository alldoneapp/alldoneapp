jest.mock(
    'firebase-functions/params',
    () => ({
        defineString: jest.fn(() => ({ value: jest.fn(() => '') })),
    }),
    { virtual: true }
)

const { BACKLOG_DATE_NUMERIC } = require('../Utils/HelperFunctionsCloud')
const { GoalRetrievalService } = require('./GoalRetrievalService')

function createSnapshot(rows) {
    const docs = rows.map(row => ({
        id: row.id,
        data: () => row.data,
    }))

    return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: callback => docs.forEach(callback),
    }
}

class FakeQuery {
    constructor(rows) {
        this.rows = rows
        this.filters = []
        this.sort = null
    }

    where(field, operator, value) {
        this.filters.push({ field, operator, value })
        return this
    }

    orderBy(field, direction = 'asc') {
        this.sort = { field, direction }
        return this
    }

    async get() {
        let results = [...this.rows]

        for (const filter of this.filters) {
            results = results.filter(row => {
                const fieldValue = row.data[filter.field]

                switch (filter.operator) {
                    case '==':
                        return fieldValue === filter.value
                    default:
                        throw new Error(`Unsupported operator: ${filter.operator}`)
                }
            })
        }

        if (this.sort) {
            const multiplier = this.sort.direction === 'desc' ? -1 : 1
            results.sort((a, b) => {
                const aValue = a.data[this.sort.field]
                const bValue = b.data[this.sort.field]

                if (aValue === bValue) return 0
                return aValue > bValue ? multiplier : -multiplier
            })
        }

        return createSnapshot(results)
    }
}

function createFakeDb() {
    const projects = {
        'project-1': { name: 'Operations', userIds: ['user-1'] },
        'project-2': { name: 'Guide Project', userIds: ['user-1'], parentTemplateId: 'template-1' },
        'project-3': { name: 'No Active Milestone', userIds: ['user-1'] },
    }

    const goalsByProject = {
        'project-1': [
            {
                id: 'goal-active',
                data: {
                    extendedName: 'Launch v2',
                    description: 'Ship the release',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    progress: 60,
                    startingMilestoneDate: 100,
                    completionMilestoneDate: 300,
                    sortIndexByMilestone: {
                        'ms-open-1': 10,
                        'ms-open-2': 8,
                    },
                },
            },
            {
                id: 'goal-backlog',
                data: {
                    extendedName: 'Someday idea',
                    description: 'Backlog item',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    progress: 40,
                    startingMilestoneDate: BACKLOG_DATE_NUMERIC,
                    completionMilestoneDate: BACKLOG_DATE_NUMERIC,
                    sortIndexByMilestone: {
                        'BACKLOGproject-1': 5,
                    },
                },
            },
            {
                id: 'goal-done',
                data: {
                    extendedName: 'QA signoff',
                    description: 'Completed work',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    progress: 100,
                    parentDoneMilestoneIds: ['ms-done-2', 'ms-done-1'],
                    progressByDoneMilestone: {
                        'ms-done-1': { progress: 80, doneDate: 190 },
                        'ms-done-2': { progress: 100, doneDate: 210 },
                    },
                    sortIndexByMilestone: {
                        'ms-done-1': 3,
                        'ms-done-2': 4,
                    },
                },
            },
            {
                id: 'goal-both',
                data: {
                    extendedName: 'Document rollout',
                    description: 'Write the guide',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    progress: 100,
                    startingMilestoneDate: 100,
                    completionMilestoneDate: 200,
                    parentDoneMilestoneIds: ['ms-done-1'],
                    progressByDoneMilestone: {
                        'ms-done-1': { progress: 100, doneDate: 180 },
                    },
                    sortIndexByMilestone: {
                        'ms-open-1': 6,
                        'ms-done-1': 1,
                    },
                    commentsData: {
                        amount: 1,
                        lastComment: 'Done',
                    },
                },
            },
        ],
        'project-2': [
            {
                id: 'goal-guide-visible',
                data: {
                    extendedName: 'Guide task',
                    ownerId: 'user-1',
                    assigneesIds: ['user-1'],
                    progress: 20,
                    startingMilestoneDate: 120,
                    completionMilestoneDate: 120,
                    sortIndexByMilestone: {
                        'guide-open-1': 9,
                    },
                },
            },
            {
                id: 'goal-guide-hidden',
                data: {
                    extendedName: 'Wrong owner',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    progress: 20,
                    startingMilestoneDate: 120,
                    completionMilestoneDate: 120,
                },
            },
        ],
        'project-3': [
            {
                id: 'goal-no-open',
                data: {
                    extendedName: 'Hidden when current milestone only',
                    ownerId: 'ALL_USERS',
                    assigneesIds: ['user-1'],
                    progress: 50,
                    startingMilestoneDate: BACKLOG_DATE_NUMERIC,
                    completionMilestoneDate: BACKLOG_DATE_NUMERIC,
                    sortIndexByMilestone: {
                        'BACKLOGproject-3': 7,
                    },
                },
            },
        ],
    }

    const milestonesByProject = {
        'project-1': [
            {
                id: 'ms-open-1',
                data: { date: 100, done: false, ownerId: 'ALL_USERS', extendedName: 'Sprint 1' },
            },
            {
                id: 'ms-open-2',
                data: { date: 200, done: false, ownerId: 'ALL_USERS', extendedName: 'Sprint 2' },
            },
            {
                id: 'ms-done-2',
                data: { date: 200, done: true, ownerId: 'ALL_USERS', extendedName: 'Release' },
            },
            {
                id: 'ms-done-1',
                data: { date: 150, done: true, ownerId: 'ALL_USERS', extendedName: 'Beta' },
            },
        ],
        'project-2': [
            {
                id: 'guide-open-1',
                data: { date: 120, done: false, ownerId: 'user-1', extendedName: 'Guide Milestone' },
            },
        ],
        'project-3': [],
    }

    return {
        collection(path) {
            if (path === 'users') {
                return {
                    doc(userId) {
                        return {
                            async get() {
                                if (userId !== 'user-1') return { exists: false, data: () => ({}) }
                                return {
                                    exists: true,
                                    data: () => ({
                                        projectIds: ['project-1', 'project-2', 'project-3'],
                                        archivedProjectIds: [],
                                        templateProjectIds: [],
                                        guideProjectIds: [],
                                    }),
                                }
                            },
                        }
                    },
                }
            }

            if (path === 'projects') {
                return {
                    doc(projectId) {
                        return {
                            async get() {
                                const project = projects[projectId]
                                return project
                                    ? { id: projectId, exists: true, data: () => project }
                                    : { exists: false, data: () => ({}) }
                            },
                        }
                    },
                }
            }

            const goalsMatch = path.match(/^goals\/([^/]+)\/items$/)
            if (goalsMatch) {
                return new FakeQuery(goalsByProject[goalsMatch[1]] || [])
            }

            const milestonesMatch = path.match(/^goalsMilestones\/([^/]+)\/milestonesItems$/)
            if (milestonesMatch) {
                return new FakeQuery(milestonesByProject[milestonesMatch[1]] || [])
            }

            throw new Error(`Unexpected collection path: ${path}`)
        },
    }
}

describe('GoalRetrievalService', () => {
    function createService() {
        return new GoalRetrievalService({
            database: createFakeDb(),
        })
    }

    test('returns active goals across projects and uses project-specific owner resolution', async () => {
        const service = createService()

        const result = await service.getGoals({
            userId: 'user-1',
        })

        expect(result.appliedFilters).toEqual({
            status: 'active',
            allProjects: true,
            projectId: null,
            projectName: null,
            currentMilestoneOnly: false,
            limit: 100,
        })
        expect(result.goals.map(goal => `${goal.projectId}:${goal.id}`)).toEqual([
            'project-1:goal-active',
            'project-1:goal-both',
            'project-1:goal-backlog',
            'project-2:goal-guide-visible',
            'project-3:goal-no-open',
        ])
        expect(result.goals.find(goal => goal.id === 'goal-guide-hidden')).toBeUndefined()
    })

    test('supports currentMilestoneOnly for active goals and excludes backlog or projects without an open milestone', async () => {
        const service = createService()

        const result = await service.getGoals({
            userId: 'user-1',
            currentMilestoneOnly: true,
        })

        expect(result.goals.map(goal => `${goal.projectId}:${goal.id}`)).toEqual([
            'project-1:goal-active',
            'project-1:goal-both',
            'project-2:goal-guide-visible',
        ])
        expect(result.goals.every(goal => goal.matchedMilestone && goal.isBacklog === false)).toBe(true)
    })

    test('returns done goals once even when they belong to multiple done milestones', async () => {
        const service = createService()

        const result = await service.getGoals({
            userId: 'user-1',
            projectId: 'project-1',
            status: 'done',
        })

        expect(result.goals.map(goal => goal.id)).toEqual(['goal-done', 'goal-both'])
        expect(result.goals[0]).toMatchObject({
            id: 'goal-done',
            status: 'done',
            latestDoneMilestoneDate: 200,
            doneMilestones: [
                { milestoneId: 'ms-done-2', date: 200, extendedName: 'Release', progress: 100 },
                { milestoneId: 'ms-done-1', date: 150, extendedName: 'Beta', progress: 80 },
            ],
        })
    })

    test('merges active and done metadata into one row per goal for status all', async () => {
        const service = createService()

        const result = await service.getGoals({
            userId: 'user-1',
            projectId: 'project-1',
            status: 'all',
            currentMilestoneOnly: true,
        })

        expect(result.goals.map(goal => `${goal.id}:${goal.status}`)).toEqual([
            'goal-active:active',
            'goal-both:both',
            'goal-done:done',
        ])
        expect(result.goals.find(goal => goal.id === 'goal-both')).toMatchObject({
            matchedMilestone: {
                id: 'ms-open-1',
                date: 100,
                extendedName: 'Sprint 1',
                ownerId: 'ALL_USERS',
            },
            latestDoneMilestoneDate: 150,
            doneMilestones: [{ milestoneId: 'ms-done-1', progress: 100 }],
        })
    })

    test('uses the current project when allProjects is false without an explicit project target', async () => {
        const service = createService()

        const result = await service.getGoals({
            userId: 'user-1',
            allProjects: false,
            currentProjectId: 'project-2',
        })

        expect(result.appliedFilters).toEqual({
            status: 'active',
            allProjects: false,
            projectId: 'project-2',
            projectName: 'Guide Project',
            currentMilestoneOnly: false,
            limit: 100,
        })
        expect(result.goals.map(goal => goal.id)).toEqual(['goal-guide-visible'])
    })
})
