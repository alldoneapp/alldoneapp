const moment = require('moment-timezone')

const { ChatRetrievalService } = require('./ChatRetrievalService')

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
                    case 'in':
                        return Array.isArray(filter.value) && filter.value.includes(fieldValue)
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

function createFakeDb({ userProjects, projects, chatsByProject, commentsByPath }) {
    return {
        collection(path) {
            if (path === 'users') {
                return {
                    doc(userId) {
                        return {
                            async get() {
                                if (userId !== 'user-1') {
                                    return { exists: false, data: () => ({}) }
                                }

                                return {
                                    exists: true,
                                    data: () => ({
                                        projectIds: userProjects,
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

            const chatMatch = path.match(/^chatObjects\/([^/]+)\/chats$/)
            if (chatMatch) {
                return new FakeQuery(chatsByProject[chatMatch[1]] || [])
            }

            return new FakeQuery(commentsByPath[path] || [])
        },
    }
}

function fixedMomentFactory(nowIso) {
    return (...args) => (args.length > 0 ? moment(...args) : moment(nowIso))
}

describe('ChatRetrievalService', () => {
    const nowFactory = fixedMomentFactory('2026-04-14T12:00:00Z')
    const chatsByProject = {
        'project-1': [
            {
                id: 'topic-1',
                data: {
                    type: 'topics',
                    title: 'Roadmap',
                    lastEditionDate: Date.UTC(2026, 3, 13, 9, 0, 0),
                    created: Date.UTC(2026, 3, 10, 8, 0, 0),
                    commentsData: { lastComment: 'Roadmap update' },
                    isPublicFor: [0, 'user-1'],
                },
            },
            {
                id: 'task-1',
                data: {
                    type: 'tasks',
                    title: 'Task thread',
                    lastEditionDate: Date.UTC(2026, 3, 14, 8, 0, 0),
                    created: Date.UTC(2026, 3, 14, 7, 0, 0),
                    commentsData: { lastComment: 'Task comment' },
                    isPublicFor: [0, 'user-1'],
                },
            },
            {
                id: 'private-topic',
                data: {
                    type: 'topics',
                    title: 'Private thread',
                    lastEditionDate: Date.UTC(2026, 3, 12, 8, 0, 0),
                    created: Date.UTC(2026, 3, 11, 8, 0, 0),
                    commentsData: { lastComment: 'Hidden' },
                    isPublicFor: ['someone-else'],
                },
            },
        ],
        'project-2': [
            {
                id: 'topic-2',
                data: {
                    type: 'topics',
                    title: 'Marketing sync',
                    lastEditionDate: Date.UTC(2026, 3, 12, 10, 0, 0),
                    created: Date.UTC(2026, 3, 9, 10, 0, 0),
                    commentsData: { lastComment: 'Need the draft' },
                    isPublicFor: [0, 'user-1'],
                },
            },
            {
                id: 'topic-old',
                data: {
                    type: 'topics',
                    title: 'Old topic',
                    lastEditionDate: Date.UTC(2026, 2, 30, 10, 0, 0),
                    created: Date.UTC(2026, 2, 30, 9, 0, 0),
                    commentsData: { lastComment: 'Old note' },
                    isPublicFor: [0, 'user-1'],
                },
            },
        ],
        'project-3': [
            {
                id: 'topic-3',
                data: {
                    type: 'topics',
                    title: 'Sales',
                    lastEditionDate: Date.UTC(2026, 3, 11, 8, 0, 0),
                    created: Date.UTC(2026, 3, 11, 7, 0, 0),
                    commentsData: { lastComment: 'Sales update' },
                    isPublicFor: [0, 'user-1'],
                },
            },
        ],
    }

    const commentsByPath = {
        'chatComments/project-1/topics/topic-1/comments': [
            {
                id: 'message-2',
                data: {
                    commentText: 'Second message',
                    created: 200,
                    fromAssistant: true,
                },
            },
            {
                id: 'message-1',
                data: {
                    commentText: 'First message',
                    created: 100,
                    fromAssistant: false,
                },
            },
        ],
        'chatComments/project-1/tasks/task-1/comments': [
            {
                id: 'task-message-1',
                data: {
                    commentText: 'Task thread message',
                    created: 300,
                    fromAssistant: false,
                },
            },
        ],
        'chatComments/project-2/topics/topic-2/comments': [
            {
                id: 'message-3',
                data: {
                    commentText: 'Need the draft',
                    created: 150,
                    fromAssistant: false,
                },
            },
        ],
        'chatComments/project-2/topics/topic-old/comments': [],
        'chatComments/project-3/topics/topic-3/comments': [
            {
                id: 'message-4',
                data: {
                    commentText: 'Sales update',
                    created: 175,
                    fromAssistant: false,
                },
            },
        ],
    }

    function createService(projectNames = {}) {
        return new ChatRetrievalService({
            database: createFakeDb({
                userProjects: ['project-1', 'project-2', 'project-3'],
                projects: {
                    'project-1': { name: 'Operations', userIds: ['user-1'] },
                    'project-2': { name: 'Marketing', userIds: ['user-1'] },
                    'project-3': { name: projectNames['project-3'] || 'Marketing Team', userIds: ['user-1'] },
                },
                chatsByProject,
                commentsByPath,
            }),
            moment: nowFactory,
        })
    }

    test('returns topic chats by default across projects with recent messages oldest to newest', async () => {
        const service = createService()

        const result = await service.getChats({
            userId: 'user-1',
            limit: 2,
        })

        expect(result.appliedFilters).toEqual({
            types: ['topics'],
            date: null,
            limit: 2,
            projectId: null,
            projectName: null,
        })
        expect(result.chats.map(chat => chat.documentId)).toEqual(['topic-1', 'topic-2'])
        expect(result.chats[0].messages).toEqual([
            {
                messageId: 'message-1',
                role: 'user',
                text: 'First message',
                createdAt: 100,
                fromAssistant: false,
            },
            {
                messageId: 'message-2',
                role: 'assistant',
                text: 'Second message',
                createdAt: 200,
                fromAssistant: true,
            },
        ])
    })

    test('supports multiple types and applies the global limit after cross-project sorting', async () => {
        const service = createService()

        const result = await service.getChats({
            userId: 'user-1',
            types: ['topics', 'tasks'],
            limit: 2,
        })

        expect(result.chats.map(chat => `${chat.type}:${chat.documentId}`)).toEqual(['tasks:task-1', 'topics:topic-1'])
    })

    test('filters chats by exact date and date range using task-style parsing', async () => {
        const service = createService()

        await expect(
            service.getChats({
                userId: 'user-1',
                date: '2026-04-12',
                limit: 10,
            })
        ).resolves.toMatchObject({
            chats: [expect.objectContaining({ documentId: 'topic-2' })],
        })

        await expect(
            service.getChats({
                userId: 'user-1',
                date: '2026-04-12 to 2026-04-13',
                limit: 10,
            })
        ).resolves.toMatchObject({
            chats: [
                expect.objectContaining({ documentId: 'topic-1' }),
                expect.objectContaining({ documentId: 'topic-2' }),
            ],
        })
    })

    test('resolves projectName and rejects ambiguous partial matches', async () => {
        const exactService = createService({ 'project-3': 'Sales Team' })
        await expect(
            exactService.getChats({
                userId: 'user-1',
                projectName: 'Marketing',
                limit: 10,
            })
        ).resolves.toMatchObject({
            appliedFilters: expect.objectContaining({
                projectId: 'project-2',
                projectName: 'Marketing',
            }),
        })

        const ambiguousService = createService()
        await expect(
            ambiguousService.getChats({
                userId: 'user-1',
                projectName: 'Market',
                limit: 10,
            })
        ).rejects.toThrow('Multiple projects partially match "Market"')
    })

    test('rejects invalid chat types and excludes invisible chats', async () => {
        const service = createService()

        await expect(
            service.getChats({
                userId: 'user-1',
                types: ['invalid-type'],
            })
        ).rejects.toThrow('Invalid chat type')

        const result = await service.getChats({
            userId: 'user-1',
            types: ['topics'],
            limit: 10,
        })

        expect(result.chats.find(chat => chat.documentId === 'private-topic')).toBeUndefined()
    })
})
