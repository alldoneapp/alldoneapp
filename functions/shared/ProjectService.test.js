const { ProjectService } = require('./ProjectService')

function createDatabase({ userData, projects }) {
    return {
        collection(collectionName) {
            return {
                doc(id) {
                    return {
                        async get() {
                            if (collectionName === 'users') {
                                return { exists: true, data: () => userData }
                            }
                            const data = projects[id]
                            return { id, exists: !!data, data: () => data }
                        },
                    }
                },
            }
        },
    }
}

describe('ProjectService', () => {
    test("keeps each user's project sort indexes in the returned projection", async () => {
        const database = createDatabase({
            userData: { projectIds: ['project-1', 'project-2'] },
            projects: {
                'project-1': {
                    name: 'One',
                    userIds: ['user'],
                    sortIndexByUser: { user: 42 },
                    contactStatuses: { lead: { name: 'Lead' } },
                },
                'project-2': { name: 'Two', userIds: ['user'] },
            },
        })
        const service = new ProjectService({ database })
        await service.initialize()

        const result = await service.getUserProjects('user')

        expect(result.map(project => project.sortIndexByUser)).toEqual([{ user: 42 }, {}])
        expect(result.map(project => project.contactStatuses)).toEqual([{ lead: { name: 'Lead' } }, {}])
    })

    // security audit 2026-11: users/{uid}.projectIds is owner-writable. Every MCP tool gate and
    // assistant tool resolver reads this list, so it must only contain projects whose own userIds
    // lists the user.
    test('drops a project the user document lists but the project does not count as membership', async () => {
        const database = createDatabase({
            userData: {
                projectIds: ['own', 'foreign', 'archived-foreign', 'guide-foreign'],
                archivedProjectIds: ['archived-foreign'],
                guideProjectIds: ['guide-foreign'],
            },
            projects: {
                own: { name: 'Own', userIds: ['user', 'other'] },
                foreign: { name: 'Foreign', userIds: ['victim'] },
                'archived-foreign': { name: 'Archived', userIds: ['victim'] },
                'guide-foreign': { name: 'Guide' },
            },
        })
        const service = new ProjectService({ database })
        await service.initialize()

        const result = await service.getUserProjects('user', {
            includeArchived: true,
            includeCommunity: true,
            activeOnly: false,
        })

        expect(result.map(project => project.id)).toEqual(['own'])
    })
})
