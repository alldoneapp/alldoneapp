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
                'project-1': { name: 'One', sortIndexByUser: { user: 42 } },
                'project-2': { name: 'Two' },
            },
        })
        const service = new ProjectService({ database })
        await service.initialize()

        const result = await service.getUserProjects('user')

        expect(result.map(project => project.sortIndexByUser)).toEqual([{ user: 42 }, {}])
    })
})
