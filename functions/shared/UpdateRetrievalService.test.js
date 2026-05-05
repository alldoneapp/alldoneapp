const moment = require('moment-timezone')

const { UpdateRetrievalService } = require('./UpdateRetrievalService')

function createSnapshot(rows) {
    const docs = rows.map(row => ({
        id: row.id,
        exists: true,
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
        this.limitValue = null
    }

    where(field, operator, value) {
        this.filters.push({ field, operator, value })
        return this
    }

    orderBy(field, direction = 'asc') {
        this.sort = { field, direction }
        return this
    }

    limit(value) {
        this.limitValue = value
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
                    case '>=':
                        return Number(fieldValue) >= Number(filter.value)
                    case '<=':
                        return Number(fieldValue) <= Number(filter.value)
                    case 'array-contains-any':
                        return (
                            Array.isArray(fieldValue) &&
                            Array.isArray(filter.value) &&
                            fieldValue.some(item => filter.value.includes(item))
                        )
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

        if (typeof this.limitValue === 'number') {
            results = results.slice(0, this.limitValue)
        }

        return createSnapshot(results)
    }
}

function createFakeDb({
    userProjects,
    archivedProjectIds = [],
    templateProjectIds = [],
    projects,
    feedsByProject,
    states,
    users,
}) {
    return {
        collection(path) {
            if (path === 'users') {
                return {
                    doc(userId) {
                        return {
                            async get() {
                                const user = users[userId]
                                if (userId === 'user-1') {
                                    return {
                                        exists: true,
                                        data: () => ({
                                            projectIds: userProjects,
                                            archivedProjectIds,
                                            templateProjectIds,
                                            guideProjectIds: [],
                                            ...(user || {}),
                                        }),
                                    }
                                }

                                return user
                                    ? {
                                          exists: true,
                                          data: () => user,
                                      }
                                    : { exists: false, data: () => ({}) }
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
                                    ? {
                                          id: projectId,
                                          exists: true,
                                          data: () => project,
                                      }
                                    : { exists: false, data: () => ({}) }
                            },
                        }
                    },
                }
            }

            const feedMatch = path.match(/^feedsStore\/([^/]+)\/all$/)
            if (feedMatch) {
                return new FakeQuery(feedsByProject[feedMatch[1]] || [])
            }

            return new FakeQuery([])
        },

        doc(path) {
            return {
                path,
                async get() {
                    const data = states[path]
                    return data
                        ? {
                              exists: true,
                              data: () => data,
                          }
                        : { exists: false, data: () => ({}) }
                },
            }
        },

        async getAll(...refs) {
            return Promise.all(refs.map(ref => ref.get()))
        },
    }
}

function fixedMomentFactory(nowIso) {
    return (...args) => (args.length > 0 ? moment(...args) : moment(nowIso))
}

describe('UpdateRetrievalService', () => {
    const nowFactory = fixedMomentFactory('2026-04-14T12:00:00Z')
    const baseFeedsByProject = {
        'project-1': [
            {
                id: 'feed-task-new',
                data: {
                    type: 'FEED_TASK_UPDATED',
                    entryText: 'updated task',
                    objectId: 'task-1',
                    creatorId: 'creator-1',
                    lastChangeDate: Date.UTC(2026, 3, 14, 10, 0, 0),
                    isPublicFor: [0],
                },
            },
            {
                id: 'feed-hidden',
                data: {
                    type: 'FEED_NOTE_UPDATED',
                    entryText: 'updated note',
                    objectId: 'note-hidden',
                    creatorId: 'creator-1',
                    lastChangeDate: Date.UTC(2026, 3, 14, 9, 0, 0),
                    isPublicFor: ['someone-else'],
                },
            },
        ],
        'project-2': [
            {
                id: 'feed-note',
                data: {
                    type: 'FEED_NOTE_UPDATED',
                    entryText: 'updated note',
                    objectId: 'note-1',
                    creatorId: 'creator-2',
                    lastChangeDate: Date.UTC(2026, 3, 13, 9, 0, 0),
                    isPublicFor: [0, 'user-1'],
                },
            },
            {
                id: 'feed-old',
                data: {
                    type: 'UNKNOWN_EVENT',
                    entryText: 'changed something',
                    objectId: 'task-old',
                    creatorId: 'creator-1',
                    lastChangeDate: Date.UTC(2026, 2, 31, 9, 0, 0),
                    isPublicFor: [0],
                },
            },
        ],
    }

    function createService(overrides = {}) {
        return new UpdateRetrievalService({
            database: createFakeDb({
                userProjects: overrides.userProjects || ['project-1', 'project-2'],
                archivedProjectIds: overrides.archivedProjectIds || [],
                templateProjectIds: overrides.templateProjectIds || [],
                projects: {
                    'project-1': { name: 'Operations', userIds: ['user-1'] },
                    'project-2': { name: 'Marketing', userIds: ['user-1'] },
                    ...(overrides.projects || {}),
                },
                feedsByProject: overrides.feedsByProject || baseFeedsByProject,
                states: {
                    'feedsObjectsLastStates/project-1/tasks/task-1': { name: 'Launch checklist' },
                    'feedsObjectsLastStates/project-2/notes/note-1': { name: 'Campaign notes' },
                    ...(overrides.states || {}),
                },
                users: {
                    'creator-1': { displayName: 'Alice Example' },
                    'creator-2': { displayName: 'Bob Example' },
                    ...(overrides.users || {}),
                },
            }),
            moment: nowFactory,
        })
    }

    test('returns visible updates across projects sorted globally with titles and creators', async () => {
        const service = createService()

        const result = await service.getUpdates({
            userId: 'user-1',
            date: 'last 7 days',
            limit: 10,
        })

        expect(result.count).toBe(2)
        expect(result.updates).toEqual([
            {
                id: 'feed-task-new',
                projectId: 'project-1',
                projectName: 'Operations',
                objectType: 'tasks',
                objectId: 'task-1',
                objectTitle: 'Launch checklist',
                eventType: 'FEED_TASK_UPDATED',
                eventText: 'updated task',
                creatorId: 'creator-1',
                creatorName: 'Alice Example',
                updatedAt: Date.UTC(2026, 3, 14, 10, 0, 0),
            },
            {
                id: 'feed-note',
                projectId: 'project-2',
                projectName: 'Marketing',
                objectType: 'notes',
                objectId: 'note-1',
                objectTitle: 'Campaign notes',
                eventType: 'FEED_NOTE_UPDATED',
                eventText: 'updated note',
                creatorId: 'creator-2',
                creatorName: 'Bob Example',
                updatedAt: Date.UTC(2026, 3, 13, 9, 0, 0),
            },
        ])
        expect(result.appliedFilters).toMatchObject({
            allProjects: true,
            date: 'last 7 days',
            recentHours: null,
            limit: 10,
        })
        expect(result.queriedProjects.map(project => project.id)).toEqual(['project-1', 'project-2'])
    })

    test('resolves project name and applies object type filters', async () => {
        const service = createService()

        const result = await service.getUpdates({
            userId: 'user-1',
            projectName: 'Marketing',
            objectTypes: ['notes'],
            limit: 10,
        })

        expect(result.updates.map(update => update.id)).toEqual(['feed-note', 'feed-old'])
        expect(result.updates[0]).toMatchObject({
            projectId: 'project-2',
            objectType: 'notes',
            objectTitle: 'Campaign notes',
        })
        expect(result.updates[1]).toMatchObject({
            projectId: 'project-2',
            objectType: null,
            objectTitle: '',
        })
        expect(result.appliedFilters).toMatchObject({
            allProjects: false,
            projectId: 'project-2',
            projectName: 'Marketing',
            objectTypes: ['notes'],
        })
    })

    test('filters by recent hours and applies global limit', async () => {
        const service = createService()

        const result = await service.getUpdates({
            userId: 'user-1',
            recentHours: 4,
            limit: 1,
        })

        expect(result.updates.map(update => update.id)).toEqual(['feed-task-new'])
        expect(result.appliedFilters).toMatchObject({
            date: null,
            recentHours: 4,
            limit: 1,
        })
    })

    test('supports current-project scope when allProjects is false', async () => {
        const service = createService()

        const result = await service.getUpdates({
            userId: 'user-1',
            currentProjectId: 'project-1',
            allProjects: false,
            limit: 10,
        })

        expect(result.updates.map(update => update.id)).toEqual(['feed-task-new'])
        expect(result.appliedFilters).toMatchObject({
            allProjects: false,
            projectId: 'project-1',
            projectName: null,
        })
    })

    test('can include archived projects when requested', async () => {
        const service = createService({
            userProjects: ['project-1'],
            archivedProjectIds: ['archived-project'],
            projects: {
                'archived-project': { name: 'Archive', userIds: ['user-1'] },
            },
            feedsByProject: {
                ...baseFeedsByProject,
                'archived-project': [
                    {
                        id: 'feed-archive',
                        data: {
                            type: 'FEED_TASK_UPDATED',
                            entryText: 'updated task',
                            objectId: 'archived-task',
                            creatorId: 'creator-1',
                            lastChangeDate: Date.UTC(2026, 3, 14, 11, 0, 0),
                            isPublicFor: [0],
                        },
                    },
                ],
            },
        })

        const result = await service.getUpdates({
            userId: 'user-1',
            includeArchived: true,
            limit: 10,
        })

        expect(result.updates.map(update => update.id)).toContain('feed-archive')
        expect(result.queriedProjects).toEqual([
            { id: 'project-1', name: 'Operations', type: 'regular' },
            { id: 'archived-project', name: 'Archive', type: 'archived' },
        ])
    })

    test('rejects ambiguous project name matches and invalid recentHours', async () => {
        const service = createService({
            userProjects: ['project-1', 'project-2', 'project-3'],
            projects: {
                'project-3': { name: 'Marketing Team', userIds: ['user-1'] },
            },
        })

        await expect(
            service.getUpdates({
                userId: 'user-1',
                projectName: 'Market',
            })
        ).rejects.toThrow('Multiple projects partially match')

        await expect(
            service.getUpdates({
                userId: 'user-1',
                recentHours: -1,
            })
        ).rejects.toThrow('recentHours must be a positive number')
    })
})
