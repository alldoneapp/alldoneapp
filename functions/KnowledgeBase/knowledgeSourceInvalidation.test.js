const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    invalidateKnowledgeSourcesOnDelete,
    invalidateKnowledgeSourcesOnUpdate,
} = require('./knowledgeSourceInvalidation')
const { isKnowledgePageVisible } = require('./knowledgeBaseModel')

const PROJECT_ID = 'project-a'
const NOW = 1_800_000_000_000
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const pagePath = slug => `${KB_PATH}/pages/${slug}`

function createDb() {
    return new KnowledgeFirestoreDouble({
        [KB_PATH]: { enabled: true, nextRunAt: NOW + 3_600_000 },
        [pagePath('kunden')]: { title: 'Kunden', sourceKeys: ['task:t1', 'contact:c1'] },
        [pagePath('entscheidungen')]: { title: 'Entscheidungen', sourceKeys: ['task:t1'] },
        [pagePath('glossar')]: { title: 'Glossar', sourceKeys: ['note:n1'] },
        [`knowledgeBases/other/pages/kunden`]: { title: 'Fremd', sourceKeys: ['task:t1'] },
    })
}

describe('invalidateKnowledgeSourcesOnUpdate', () => {
    it('hides every page citing an object that was just made private and schedules a rebuild', async () => {
        const db = createDb()

        const result = await invalidateKnowledgeSourcesOnUpdate({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            objectType: 'tasks',
            objectId: 't1',
            before: { isPublicFor: [0, 'owner'] },
            after: { isPublicFor: ['owner'] },
        })

        expect(result).toEqual({ pages: 2 })
        const kunden = db.read(pagePath('kunden'))
        expect(kunden).toMatchObject({
            needsRebuild: true,
            needsRebuildSince: NOW,
            needsRebuildReason: 'privacy',
            sourceKeys: ['contact:c1'],
            removedSourceKeys: ['task:t1'],
        })
        expect(isKnowledgePageVisible(kunden)).toBe(false)
        expect(isKnowledgePageVisible(db.read(pagePath('glossar')))).toBe(true)
        expect(db.read(KB_PATH)).toMatchObject({ nextRunAt: NOW, rebuildRequestedAt: NOW })
        // Another project's wiki is untouched.
        expect(db.read('knowledgeBases/other/pages/kunden').needsRebuild).toBeUndefined()
    })

    it('does nothing when visibility was not taken away', async () => {
        const db = createDb()
        const cases = [
            { before: { isPublicFor: [0, 'owner'] }, after: { isPublicFor: [0, 'owner', 'teammate'] } },
            { before: { isPublicFor: ['owner'] }, after: { isPublicFor: [0, 'owner'] } },
            { before: { isPublicFor: ['owner'] }, after: { isPublicFor: ['teammate'] } },
        ]

        for (const change of cases) {
            await expect(
                invalidateKnowledgeSourcesOnUpdate({
                    db,
                    fieldValue,
                    projectId: PROJECT_ID,
                    objectType: 'tasks',
                    objectId: 't1',
                    ...change,
                })
            ).resolves.toEqual({ pages: 0 })
        }
        expect(db.queries).toHaveLength(0)
    })

    it('treats isPrivate as taking visibility away even if isPublicFor lags behind', async () => {
        const db = createDb()

        const result = await invalidateKnowledgeSourcesOnUpdate({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            objectType: 'contacts',
            objectId: 'c1',
            before: { isPublicFor: [0] },
            after: { isPublicFor: [0], isPrivate: true },
        })

        expect(result).toEqual({ pages: 1 })
    })

    it('ignores object types the wiki does not compile', async () => {
        const db = createDb()
        await expect(
            invalidateKnowledgeSourcesOnUpdate({
                db,
                fieldValue,
                projectId: PROJECT_ID,
                objectType: 'skills',
                objectId: 's1',
                before: { isPublicFor: [0] },
                after: { isPublicFor: ['owner'] },
            })
        ).resolves.toEqual({ pages: 0 })
    })
})

describe('invalidateKnowledgeSourcesOnDelete', () => {
    it('hides the pages citing a deleted object', async () => {
        const db = createDb()

        const result = await invalidateKnowledgeSourcesOnDelete({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            objectType: 'notes',
            objectId: 'n1',
            data: { isPublicFor: [0, 'owner'] },
        })

        expect(result).toEqual({ pages: 1 })
        expect(db.read(pagePath('glossar'))).toMatchObject({
            needsRebuild: true,
            needsRebuildReason: 'deleted',
            sourceKeys: [],
        })
    })

    it('skips the query for an object the whole project could never see', async () => {
        const db = createDb()

        await invalidateKnowledgeSourcesOnDelete({
            db,
            fieldValue,
            projectId: PROJECT_ID,
            objectType: 'tasks',
            objectId: 't1',
            data: { isPublicFor: ['owner'] },
        })

        expect(db.queries).toHaveLength(0)
        expect(db.read(pagePath('kunden')).needsRebuild).toBeUndefined()
    })

    it('writes nothing when no page cites the object', async () => {
        const db = createDb()

        const result = await invalidateKnowledgeSourcesOnDelete({
            db,
            fieldValue,
            projectId: PROJECT_ID,
            objectType: 'goals',
            objectId: 'unrelated',
            data: {},
        })

        expect(result).toEqual({ pages: 0 })
        expect(db.commits).toBe(0)
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 3_600_000)
    })
})
