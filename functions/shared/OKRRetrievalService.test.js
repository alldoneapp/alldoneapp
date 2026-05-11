const { OKRRetrievalService } = require('./OKRRetrievalService')

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
    }

    where(field, operator, value) {
        this.filters.push({ field, operator, value })
        return this
    }

    async get() {
        let results = [...this.rows]
        for (const filter of this.filters) {
            results = results.filter(row => {
                const fieldValue = row.data[filter.field]
                if (filter.operator === '==') return fieldValue === filter.value
                throw new Error(`Unsupported operator: ${filter.operator}`)
            })
        }
        return createSnapshot(results)
    }
}

function createFakeDb() {
    const projects = {
        'project-1': { name: 'Operations' },
        'project-2': { name: 'Marketing' },
        'project-archived': { name: 'Archived' },
    }

    const okrsByProject = {
        'project-1': [
            {
                id: 'okr-active-owned',
                data: {
                    objectType: 'okr',
                    label: 'Reach revenue',
                    ownerId: 'user-1',
                    currentValue: 5,
                    targetValue: 10,
                    unit: 'k',
                    cadence: 'monthly',
                    periodStart: 100,
                    periodEnd: 200,
                    status: 'active',
                },
            },
            {
                id: 'okr-closed-owned',
                data: {
                    objectType: 'okr',
                    label: 'Closed target',
                    ownerId: 'user-1',
                    currentValue: 10,
                    targetValue: 10,
                    cadence: 'weekly',
                    periodStart: 1,
                    periodEnd: 99,
                    status: 'closed',
                },
            },
            {
                id: 'okr-other-owner',
                data: {
                    objectType: 'okr',
                    label: 'Other user target',
                    ownerId: 'user-2',
                    currentValue: 1,
                    targetValue: 10,
                    cadence: 'monthly',
                    periodStart: 100,
                    periodEnd: 200,
                    status: 'active',
                },
            },
        ],
        'project-2': [
            {
                id: 'okr-marketing',
                data: {
                    objectType: 'okr',
                    label: 'Grow newsletter',
                    ownerId: 'user-1',
                    currentValue: 40,
                    targetValue: 100,
                    cadence: 'quarterly',
                    periodStart: 150,
                    periodEnd: 300,
                    status: 'active',
                },
            },
        ],
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
                                        projectIds: ['project-1', 'project-2', 'project-archived'],
                                        archivedProjectIds: ['project-archived'],
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
                                return {
                                    id: projectId,
                                    exists: !!project,
                                    data: () => project || {},
                                }
                            },
                        }
                    },
                }
            }

            const okrMatch = path.match(/^okrs\/([^/]+)\/projectOkrs$/)
            if (okrMatch) return new FakeQuery(okrsByProject[okrMatch[1]] || [])

            throw new Error(`Unexpected collection path: ${path}`)
        },
    }
}

describe('OKRRetrievalService', () => {
    test('returns only current-user OKRs even when another ownerId is requested', async () => {
        const service = new OKRRetrievalService({ database: createFakeDb() })
        const result = await service.getOKRs({
            userId: 'user-1',
            ownerId: 'user-2',
            currentProjectId: 'project-1',
            allProjects: false,
            status: 'all',
        })

        expect(result.okrs.map(okr => okr.id)).toEqual(['okr-active-owned', 'okr-closed-owned'])
        expect(result.okrs.every(okr => okr.ownerId === 'user-1')).toBe(true)
        expect(result.appliedFilters.ownerId).toBe('user-1')
    })

    test('enforces project access when an explicit projectId is requested', async () => {
        const service = new OKRRetrievalService({ database: createFakeDb() })

        await expect(
            service.getOKRs({
                userId: 'user-1',
                projectId: 'project-archived',
            })
        ).rejects.toThrow('Target project not found or not accessible')
    })

    test('filters by status and overlapping period range across accessible projects', async () => {
        const service = new OKRRetrievalService({ database: createFakeDb() })
        const result = await service.getOKRs({
            userId: 'user-1',
            allProjects: true,
            status: 'active',
            periodStart: 120,
            periodEnd: 250,
        })

        expect(result.okrs.map(okr => okr.id)).toEqual(['okr-active-owned', 'okr-marketing'])
        expect(result.okrs.map(okr => okr.progress)).toEqual([50, 40])
        expect(result.appliedFilters.allProjects).toBe(true)
    })
})
