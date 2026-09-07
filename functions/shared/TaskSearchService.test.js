const TaskSearchService = require('./TaskSearchService')

const userId = 'user-1'
const internalId = 'uD9biHyaWlcOSiPUQB9P'
const taskPath = `items/project-1/tasks/${internalId}`
const task = {
    name: 'Krimidinner für Hochzeitstag buchen',
    humanReadableId: 'PT-4902',
    isPublicFor: [userId],
}
const projects = [
    { id: 'project-1', name: 'Privat' },
    { id: 'project-2', name: 'Project' },
]

function createService(records = { [taskPath]: task }, accessibleProjects = projects) {
    const snapshot = path => ({
        id: path.split('/').pop(),
        exists: !!records[path],
        data: () => records[path],
    })
    const database = {
        doc: jest.fn(path => ({ get: jest.fn(async () => snapshot(path)) })),
        collection: jest.fn(path => ({
            where: (field, operator, value) => ({
                get: jest.fn(async () => ({
                    docs: Object.keys(records)
                        .filter(key => key.startsWith(`${path}/`) && records[key][field] === value)
                        .map(snapshot),
                })),
            }),
        })),
    }
    const service = new TaskSearchService({ database })
    service.initialized = true
    service.projectService = { getUserProjects: jest.fn().mockResolvedValue(accessibleProjects) }
    service.searchTasksWithAlgolia = jest.fn().mockRejectedValue(new Error('Search index unavailable'))
    return { service, database }
}

describe('TaskSearchService exact task IDs', () => {
    test.each(['PT-4902', ' pt-4902 '])(
        'resolves %s to the canonical document without a search index',
        async taskId => {
            const { service } = createService()
            const result = await service.findTaskForUpdate(userId, {
                taskId,
                name: `${task.name} – https://example.com/ticket`,
            })

            expect(result.decision).toBe('auto_select')
            expect(result.selectedMatch).toMatchObject({
                task: { id: internalId, humanReadableId: 'PT-4902' },
                projectId: 'project-1',
            })
            expect(service.searchTasksWithAlgolia).not.toHaveBeenCalled()
        }
    )

    test('preserves internal ID lookup and ignores an embedded stale id field', async () => {
        const { service, database } = createService({ [taskPath]: { ...task, id: 'stale-id' } })
        const result = await service.findTaskForUpdate(userId, { taskId: internalId })

        expect(result.selectedMatch.task.id).toBe(internalId)
        expect(database.collection).not.toHaveBeenCalled()
    })

    test('does not resolve a neighboring task number', async () => {
        const { service } = createService()
        const result = await service.findTaskForUpdate(userId, { taskId: 'PT-490' })
        expect(result.decision).toBe('no_matches')
    })

    test('does not expose a private task belonging to another user', async () => {
        const { service } = createService({ [taskPath]: { ...task, isPublicFor: ['other-user'] } })
        const result = await service.findTaskForUpdate(userId, { taskId: 'PT-4902' })
        expect(result.decision).toBe('no_matches')
    })

    test('preserves public task visibility', async () => {
        const { service } = createService({ [taskPath]: { ...task, isPublicFor: [0] } })
        const result = await service.findTaskForUpdate(userId, { taskId: 'PT-4902' })
        expect(result.selectedMatch.task.id).toBe(internalId)
    })

    test('does not search projects outside the accessible project list', async () => {
        const { service, database } = createService(undefined, [projects[1]])
        const result = await service.findTaskForUpdate(userId, { taskId: 'PT-4902' })
        expect(result.decision).toBe('no_matches')
        expect(database.collection).not.toHaveBeenCalledWith('items/project-1/tasks')
    })

    test('requires selection when accessible projects share a task number', async () => {
        const { service } = createService({
            [taskPath]: task,
            'items/project-2/tasks/another-task': task,
        })
        const result = await service.findTaskForUpdate(userId, { taskId: 'PT-4902' })
        expect(result.decision).toBe('present_options')
        expect(result.shouldProceedWithUpdate).toBe(false)
        expect(result.allMatches).toHaveLength(2)
    })

    test.each([{ projectId: 'project-2' }, { projectName: 'Project' }])(
        'uses project criteria %j to resolve a duplicate visible number',
        async criteria => {
            const { service } = createService({
                [taskPath]: task,
                'items/project-2/tasks/another-task': task,
            })
            const result = await service.findTaskForUpdate(userId, { taskId: 'PT-4902', ...criteria })
            expect(result.decision).toBe('auto_select')
            expect(result.selectedMatch).toMatchObject({
                projectId: 'project-2',
                task: { id: 'another-task' },
            })
        }
    )

    test('does not update from a partial lookup when another project read fails', async () => {
        const { service, database } = createService()
        const collection = database.collection.getMockImplementation()
        database.collection.mockImplementation(path => {
            if (path === 'items/project-2/tasks') {
                return {
                    where: () => ({
                        get: async () => {
                            throw new Error('Firestore unavailable')
                        },
                    }),
                }
            }
            return collection(path)
        })
        await expect(service.findTaskForUpdate(userId, { taskId: 'PT-4902' })).rejects.toThrow('Firestore unavailable')
    })

    test('rechecks candidate existence before allowing an update', async () => {
        const records = { [taskPath]: task }
        const { service } = createService(records)
        const verify = service.filterExistingAccessibleMatches.bind(service)
        service.filterExistingAccessibleMatches = async (...args) => {
            delete records[taskPath]
            return verify(...args)
        }
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const result = await service.findTaskForUpdate(userId, { taskId: 'PT-4902' })
            expect(result.decision).toBe('no_matches')
        } finally {
            warn.mockRestore()
        }
    })
})
