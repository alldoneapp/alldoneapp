'use strict'

const moment = require('moment-timezone')

const { ContactRetrievalService } = require('./ContactRetrievalService')

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

                switch (filter.operator) {
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

        return createSnapshot(results)
    }
}

function createFakeDb({
    userProjects,
    archivedProjectIds = [],
    templateProjectIds = [],
    guideProjectIds = [],
    projects,
    contactsByProject,
}) {
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
                                        archivedProjectIds,
                                        templateProjectIds,
                                        guideProjectIds,
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

            const contactsMatch = path.match(/^projectsContacts\/([^/]+)\/contacts$/)
            if (contactsMatch) {
                return new FakeQuery(contactsByProject[contactsMatch[1]] || [])
            }

            return new FakeQuery([])
        },
    }
}

function fixedMomentFactory(nowIso) {
    return (...args) => (args.length > 0 ? moment(...args) : moment(nowIso))
}

describe('ContactRetrievalService', () => {
    const nowFactory = fixedMomentFactory('2026-04-15T12:00:00Z')
    const projects = {
        'project-1': { name: 'Product', userIds: ['user-1'], active: true },
        'project-2': { name: 'Marketing', userIds: ['user-1'], active: true },
        'project-3': { name: 'Sales Ops', userIds: ['user-1'], active: true },
        archived: { name: 'Archived', userIds: ['user-1'], active: true },
    }
    const contactsByProject = {
        'project-1': [
            {
                id: 'contact-1',
                data: {
                    displayName: 'Alice Example',
                    email: 'alice@example.com',
                    emails: ['alice@example.com'],
                    company: 'Acme',
                    role: 'Buyer',
                    phone: '+491234',
                    linkedInUrl: 'https://linkedin.com/in/alice',
                    description: 'Main contact',
                    lastEditionDate: Date.UTC(2026, 3, 14, 10, 0, 0),
                    isPublicFor: [0, 'user-1'],
                },
            },
            {
                id: 'contact-hidden',
                data: {
                    displayName: 'Hidden Contact',
                    email: 'hidden@example.com',
                    lastEditionDate: Date.UTC(2026, 3, 14, 8, 0, 0),
                    isPublicFor: ['other-user'],
                },
            },
        ],
        'project-2': [
            {
                id: 'contact-2',
                data: {
                    displayName: 'Bob Example',
                    email: 'bob@example.com',
                    company: 'Bravo',
                    role: 'CMO',
                    description: 'Warm lead',
                    lastEditionDate: Date.UTC(2026, 3, 10, 9, 0, 0),
                    isPublicFor: [0, 'user-1'],
                },
            },
            {
                id: 'contact-3',
                data: {
                    displayName: 'Carol Example',
                    email: 'carol@example.com',
                    lastEditionDate: Date.UTC(2026, 3, 15, 7, 0, 0),
                    isPublicFor: [0, 'user-1'],
                },
            },
            {
                id: 'contact-old',
                data: {
                    displayName: 'Old Contact',
                    email: 'old@example.com',
                    lastEditionDate: Date.UTC(2026, 2, 30, 12, 0, 0),
                    isPublicFor: [0, 'user-1'],
                },
            },
        ],
        'project-3': [
            {
                id: 'contact-4',
                data: {
                    displayName: 'Delta Example',
                    email: 'delta@example.com',
                    lastEditionDate: Date.UTC(2026, 3, 13, 9, 0, 0),
                    isPublicFor: [0, 'user-1'],
                },
            },
        ],
        archived: [
            {
                id: 'archived-contact',
                data: {
                    displayName: 'Archived Contact',
                    email: 'archived@example.com',
                    lastEditionDate: Date.UTC(2026, 3, 15, 6, 0, 0),
                    isPublicFor: [0, 'user-1'],
                },
            },
        ],
    }

    function createService() {
        const database = createFakeDb({
            userProjects: ['project-1', 'project-2', 'project-3', 'archived'],
            archivedProjectIds: ['archived'],
            projects,
            contactsByProject,
        })

        return new ContactRetrievalService({
            database,
            moment: nowFactory,
        })
    }

    test('retrieves contacts across accessible active regular projects by default', async () => {
        const service = createService()
        await service.initialize()

        const result = await service.getContacts({ userId: 'user-1' })

        expect(result.contacts.map(contact => contact.contactId)).toEqual([
            'contact-3',
            'contact-1',
            'contact-4',
            'contact-2',
            'contact-old',
        ])
        expect(result.count).toBe(5)
        expect(result.appliedFilters).toEqual({
            allProjects: true,
            projectId: null,
            projectName: null,
            date: null,
            limit: 100,
        })
    })

    test('limits contact retrieval to a specific project id', async () => {
        const service = createService()
        await service.initialize()

        const result = await service.getContacts({
            userId: 'user-1',
            projectId: 'project-1',
        })

        expect(result.contacts.map(contact => contact.contactId)).toEqual(['contact-1'])
        expect(result.appliedFilters).toEqual({
            allProjects: false,
            projectId: 'project-1',
            projectName: 'Product',
            date: null,
            limit: 100,
        })
    })

    test('resolves project scoping by exact and partial project name', async () => {
        const service = createService()
        await service.initialize()

        const exactMatch = await service.getContacts({
            userId: 'user-1',
            projectName: 'Marketing',
        })
        const partialMatch = await service.getContacts({
            userId: 'user-1',
            projectName: 'Sales',
        })

        expect(exactMatch.contacts.map(contact => contact.contactId)).toEqual(['contact-3', 'contact-2', 'contact-old'])
        expect(partialMatch.contacts.map(contact => contact.contactId)).toEqual(['contact-4'])
    })

    test('filters out contacts the user cannot access', async () => {
        const service = createService()
        await service.initialize()

        const result = await service.getContacts({
            userId: 'user-1',
            projectId: 'project-1',
        })

        expect(result.contacts.map(contact => contact.contactId)).toEqual(['contact-1'])
        expect(result.contacts.find(contact => contact.contactId === 'contact-hidden')).toBeUndefined()
    })

    test('filters contacts edited today', async () => {
        const service = createService()
        await service.initialize()

        const result = await service.getContacts({
            userId: 'user-1',
            date: 'today',
        })

        expect(result.contacts.map(contact => contact.contactId)).toEqual(['contact-3'])
    })

    test('filters contacts edited last week', async () => {
        const service = createService()
        await service.initialize()

        const result = await service.getContacts({
            userId: 'user-1',
            date: 'last week',
        })

        expect(result.contacts.map(contact => contact.contactId)).toEqual(['contact-2'])
    })

    test('filters contacts by explicit date and date range', async () => {
        const service = createService()
        await service.initialize()

        const exactDay = await service.getContacts({
            userId: 'user-1',
            date: '2026-04-14',
        })
        const range = await service.getContacts({
            userId: 'user-1',
            date: '2026-04-13 to 2026-04-15',
        })

        expect(exactDay.contacts.map(contact => contact.contactId)).toEqual(['contact-1'])
        expect(range.contacts.map(contact => contact.contactId)).toEqual(['contact-3', 'contact-1', 'contact-4'])
    })
})
