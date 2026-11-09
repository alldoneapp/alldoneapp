const calls = []

jest.mock('firebase-admin', () => {
    const emptyQuery = { get: async () => ({ forEach: () => {} }) }
    const vmSessionDocs = [{ ref: { delete: jest.fn(async () => calls.push('delete:vmSessions/p1__t1')) } }]
    const firestore = () => ({
        collection: name => ({
            where: () =>
                name === 'vmSessions'
                    ? { get: async () => ({ forEach: fn => vmSessionDocs.forEach(fn) }) }
                    : emptyQuery,
            doc: id => ({ set: async () => calls.push(`tombstone:${name}/${id}`) }),
        }),
        doc: path => ({ delete: async () => calls.push(`delete:${path}`) }),
    })
    const storage = () => ({
        bucket: name => ({ deleteFiles: async ({ prefix }) => calls.push(`storage:${name}/${prefix}`) }),
    })
    return { firestore, storage }
})
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    recursiveDeleteHelper: jest.fn(async path => calls.push(`recursive:${path}`)),
}))
jest.mock('../AlgoliaGlobalSearchHelper', () => ({ removeAlgoliaRecordsInProject: jest.fn(async () => {}) }))
jest.mock('../Assistant/assistantHeartbeatSchedule', () => ({
    deleteHeartbeatSchedulesForProject: jest.fn(async () => {}),
    safelySyncHeartbeatSchedules: jest.fn(async fn => fn()),
}))
jest.mock('../shared/notesStorageBucket', () => ({ getNotesBucketName: () => 'notescontentprod' }))

const { onDeleteProject } = require('./onDeleteProjectFunctions')

describe('onDeleteProject (security audit NV-26)', () => {
    beforeEach(() => {
        calls.length = 0
    })

    test('tombstones the id before anything else', async () => {
        await onDeleteProject('p1')
        expect(calls[0]).toBe('tombstone:deletedProjects/p1')
    })

    test.each([
        'knowledgeBases',
        'okrs',
        'artifactUploadIndex',
        'vmGoldens',
        'assistantSkills',
        'assistantSkillImports',
        'projectHappiness',
        'chatFollowers',
        'oldFeeds',
        'workstreams',
        'notesCollab',
        'firestoreAccessProjectionJobs',
        'items',
    ])('removes the %s root', async root => {
        await onDeleteProject('p1')
        expect(calls).toContain(`recursive:${root}/p1`)
    })

    test('removes the project VM sessions and note bodies', async () => {
        await onDeleteProject('p1')
        expect(calls).toContain('delete:vmSessions/p1__t1')
        expect(calls).toContain('storage:notescontentprod/notesData/p1/')
    })
})
