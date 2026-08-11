/**
 * AT-2258 — the one-shot repair of the goals/chats creator facet.
 *
 * This runs against production data exactly once, so the things worth pinning
 * are the ones that would make it silently do nothing (the commonest outcome
 * for this whole feature area) or do too much:
 *
 *   - it must DELETE a leftover trigger doc before writing it, because the
 *     indexation trigger is `onDocumentCreated` and a `set` over an existing
 *     doc is an update, which fires nothing;
 *   - it must push the facet settings even when a project reindex fails, since
 *     that half is index-wide and unblocks every project that did succeed;
 *   - it must not close the migration marker on a partial run, or the retry
 *     never happens;
 *   - it must never touch tasks/notes/contacts, which already work.
 */
const docRefs = new Map()
const collections = {}

const makeDocRef = path => {
    if (!docRefs.has(path)) {
        docRefs.set(path, {
            path,
            exists: false,
            data: null,
            deletes: 0,
            sets: [],
            get: jest.fn(async () => {
                const ref = docRefs.get(path)
                return { exists: ref.exists, data: () => ref.data }
            }),
            delete: jest.fn(async () => {
                const ref = docRefs.get(path)
                ref.deletes += 1
                ref.exists = false
                ref.data = null
            }),
            set: jest.fn(async value => {
                const ref = docRefs.get(path)
                ref.sets.push({ value, afterDeletes: ref.deletes })
                ref.exists = true
                ref.data = value
            }),
        })
    }
    return docRefs.get(path)
}

jest.mock(
    'firebase-admin',
    () => ({
        firestore: () => ({
            doc: path => makeDocRef(path),
            collection: name => ({
                where: (field, op, value) => ({
                    get: async () => ({
                        docs: (collections[name] || [])
                            .filter(doc => doc[field] === value)
                            .map(doc => ({ id: doc.id })),
                    }),
                }),
            }),
        }),
    }),
    { virtual: true }
)

const settingsPushes = []
jest.mock(
    '../searchHelper',
    () => ({
        getAlgoliaClient: () => ({ initIndex: indexName => ({ indexName }) }),
        configAlgoliaIndex: async (index, objectsType) => {
            if (index.failConfig) throw new Error('algolia unreachable')
            settingsPushes.push({ indexName: index.indexName, objectsType })
        },
        getIndexName: objectsType => (objectsType === 'goals' ? 'dev_goals' : 'dev_updates'),
        GOALS_OBJECTS_TYPE: 'goals',
        CHATS_OBJECTS_TYPE: 'chats',
    }),
    { virtual: true }
)

const { runCreatorFacetReindex, MIGRATION_MARKER, OBJECT_TYPES_TO_REINDEX } = require('./creatorFacetReindex')

const triggerPath = (projectId, objectType) => `algoliaIndexation/${projectId}/objectTypes/${objectType}`

beforeEach(() => {
    docRefs.clear()
    settingsPushes.length = 0
    collections.projects = [
        { id: 'project-1', active: true },
        { id: 'project-2', active: true },
        { id: 'archived-1', active: false },
    ]
})

describe('runCreatorFacetReindex', () => {
    it('declares the creator facet on the goals and chats indexes', async () => {
        await runCreatorFacetReindex()

        expect(settingsPushes).toEqual([
            { indexName: 'dev_goals', objectsType: 'goals' },
            { indexName: 'dev_updates', objectsType: 'chats' },
        ])
    })

    it('queues goals and chats for every active project, and nothing else', async () => {
        const result = await runCreatorFacetReindex()

        expect(result.projects).toBe(2)
        expect(result.queued).toBe(4)
        expect(OBJECT_TYPES_TO_REINDEX).toEqual(['goals', 'chats'])
        ;['project-1', 'project-2'].forEach(projectId => {
            OBJECT_TYPES_TO_REINDEX.forEach(objectType => {
                expect(docRefs.get(triggerPath(projectId, objectType)).sets).toHaveLength(1)
            })
        })
        // Inactive projects and the already-working object types are untouched.
        expect(docRefs.has(triggerPath('archived-1', 'goals'))).toBe(false)
        ;['tasks', 'notes', 'contacts'].forEach(objectType => {
            expect(docRefs.has(triggerPath('project-1', objectType))).toBe(false)
        })
    })

    it('writes a trigger doc that carries no full-search grant', async () => {
        await runCreatorFacetReindex()

        expect(docRefs.get(triggerPath('project-1', 'goals')).sets[0].value).toEqual({ activeFullSearchDate: null })
    })

    it('deletes a leftover trigger doc first, so the onCreate trigger actually fires', async () => {
        // A doc left behind by an aborted run makes `set` an UPDATE, which fires
        // no `onDocumentCreated` event at all — the project would be skipped in
        // total silence, and precisely the projects that failed before.
        const leftover = makeDocRef(triggerPath('project-1', 'goals'))
        leftover.exists = true
        leftover.data = { activeFullSearchDate: null }

        await runCreatorFacetReindex()

        expect(leftover.deletes).toBe(1)
        expect(leftover.sets).toHaveLength(1)
        expect(leftover.sets[0].afterDeletes).toBe(1)
    })

    it('is a one-shot: a completed marker short-circuits the whole run', async () => {
        const marker = makeDocRef(MIGRATION_MARKER)
        marker.exists = true
        marker.data = { completed: true }

        const result = await runCreatorFacetReindex()

        expect(result).toEqual({ alreadyCompleted: true, projects: 0, queued: 0, indexesConfigured: [] })
        expect(settingsPushes).toHaveLength(0)
        expect(docRefs.has(triggerPath('project-1', 'goals'))).toBe(false)
    })

    it('runs again when forced', async () => {
        const marker = makeDocRef(MIGRATION_MARKER)
        marker.exists = true
        marker.data = { completed: true }

        const result = await runCreatorFacetReindex({ force: true })

        expect(result.alreadyCompleted).toBe(false)
        expect(result.queued).toBe(4)
    })

    it('closes the marker only after a clean full run', async () => {
        await runCreatorFacetReindex()

        const marker = docRefs.get(MIGRATION_MARKER)
        expect(marker.sets).toHaveLength(1)
        expect(marker.sets[0].value).toMatchObject({ completed: true, projects: 2, queued: 4 })
    })

    it('leaves the marker open when a project fails, so the schedule retries it', async () => {
        const failing = makeDocRef(triggerPath('project-2', 'chats'))
        failing.set = jest.fn(async () => {
            throw new Error('firestore unavailable')
        })

        const result = await runCreatorFacetReindex()

        expect(result.failures).toEqual(['project-2/chats: firestore unavailable'])
        expect(result.queued).toBe(3)
        expect(docRefs.get(MIGRATION_MARKER).sets).toHaveLength(0)
        // The index-wide half still landed, so every project that did succeed
        // filters correctly instead of the feature staying dark for everyone.
        expect(settingsPushes).toHaveLength(2)
    })

    describe('with an explicit project list', () => {
        it('repairs exactly those projects, ignoring active/inactive', async () => {
            const result = await runCreatorFacetReindex({ projectIds: ['archived-1'] })

            expect(result.projects).toBe(1)
            expect(docRefs.get(triggerPath('archived-1', 'goals')).sets).toHaveLength(1)
            expect(docRefs.has(triggerPath('project-1', 'goals'))).toBe(false)
        })

        it('is not blocked by the marker, and does not claim to have completed the migration', async () => {
            const marker = makeDocRef(MIGRATION_MARKER)
            marker.exists = true
            marker.data = { completed: true }

            const result = await runCreatorFacetReindex({ projectIds: ['archived-1'] })

            expect(result.alreadyCompleted).toBe(false)
            expect(result.queued).toBe(2)
            expect(marker.sets).toHaveLength(0)
        })
    })
})
