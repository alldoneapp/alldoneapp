const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    invalidateKnowledgeSourcesOnDelete,
    invalidateKnowledgeSourcesOnUpdate,
    invalidateThreadSourceOnChatDelete,
    invalidateThreadSourceOnChatUpdate,
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

        expect(result).toEqual({ pages: 2, redactedRevisions: 0 })
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

    it('takes the hidden pages out of global search at once, not only when their trigger runs', async () => {
        const db = createDb()
        const removeFromSearch = jest.fn(async () => {})

        await invalidateKnowledgeSourcesOnUpdate({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            objectType: 'tasks',
            objectId: 't1',
            before: { isPublicFor: [0, 'owner'] },
            after: { isPublicFor: ['owner'] },
            removeFromSearch,
        })

        expect(removeFromSearch).toHaveBeenCalledWith({
            projectId: PROJECT_ID,
            slugs: expect.arrayContaining(['kunden', 'entscheidungen']),
        })

        // A failing search service never undoes or blocks the withdrawal itself.
        const failing = createDb()
        await expect(
            invalidateKnowledgeSourcesOnUpdate({
                db: failing,
                fieldValue,
                now: NOW,
                projectId: PROJECT_ID,
                objectType: 'tasks',
                objectId: 't1',
                before: { isPublicFor: [0, 'owner'] },
                after: { isPublicFor: ['owner'] },
                removeFromSearch: async () => {
                    throw new Error('search down')
                },
            })
        ).resolves.toEqual({ pages: 2, redactedRevisions: 0 })
        expect(failing.read(pagePath('kunden')).needsRebuild).toBe(true)
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
            ).resolves.toEqual({ pages: 0, redactedRevisions: 0 })
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

        expect(result).toEqual({ pages: 1, redactedRevisions: 0 })
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
        ).resolves.toEqual({ pages: 0, redactedRevisions: 0 })
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

        expect(result).toEqual({ pages: 1, redactedRevisions: 0 })
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

        expect(result).toEqual({ pages: 0, redactedRevisions: 0 })
        expect(db.commits).toBe(0)
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 3_600_000)
    })
})

describe('comment threads and artifacts', () => {
    function createThreadDb() {
        return new KnowledgeFirestoreDouble({
            [KB_PATH]: { enabled: true, nextRunAt: NOW + 3_600_000 },
            [pagePath('release')]: { title: 'Release', body: 'Termin steht [[chat:t1]]', sourceKeys: ['chat:t1'] },
            [pagePath('chat')]: { title: 'Team', body: 'Absprache [[chat:topic1]]', sourceKeys: ['chat:topic1'] },
            [pagePath('berichte')]: { title: 'Berichte', body: 'Siehe [[artifact:a1]]', sourceKeys: ['artifact:a1'] },
        })
    }

    it("withdraws an object's thread together with the object when it turns private", async () => {
        const db = createThreadDb()

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

        expect(result).toEqual({ pages: 1, redactedRevisions: 0 })
        const page = db.read(pagePath('release'))
        expect(page).toMatchObject({ needsRebuild: true, sourceKeys: [], removedSourceKeys: ['chat:t1'] })
        expect(page.body).toBeUndefined()
        expect(isKnowledgePageVisible(db.read(pagePath('chat')))).toBe(true)
    })

    it('withdraws an artifact, and its thread, when it turns private', async () => {
        const db = createThreadDb()

        await invalidateKnowledgeSourcesOnUpdate({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            objectType: 'artifacts',
            objectId: 'a1',
            before: { isPublicFor: [0, 'owner'] },
            after: { isPublicFor: ['owner'], isPrivate: true },
        })

        expect(db.read(pagePath('berichte'))).toMatchObject({ needsRebuild: true, removedSourceKeys: ['artifact:a1'] })
        // Its comment thread is looked up as well.
        expect(new Set(db.queries.map(query => query.filters[0].value))).toEqual(new Set(['artifact:a1', 'chat:a1']))
    })

    it('withdraws a topic that was made private, and only a topic', async () => {
        const db = createThreadDb()

        const topic = await invalidateThreadSourceOnChatUpdate({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            chatId: 'topic1',
            before: { type: 'topics', isPublicFor: [0] },
            after: { type: 'topics', isPublicFor: ['owner'] },
        })
        // A task thread's chat object does not decide who may read it; the task does.
        const taskThread = await invalidateThreadSourceOnChatUpdate({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            chatId: 't1',
            before: { type: 'tasks', isPublicFor: [0] },
            after: { type: 'tasks', isPublicFor: ['owner'] },
        })

        expect(topic).toEqual({ pages: 1, redactedRevisions: 0 })
        expect(taskThread).toEqual({ pages: 0, redactedRevisions: 0 })
        expect(db.read(pagePath('chat'))).toMatchObject({ needsRebuild: true, needsRebuildReason: 'privacy' })
        expect(isKnowledgePageVisible(db.read(pagePath('release')))).toBe(true)
    })

    it('withdraws a deleted thread, but never queries for a topic nobody else could read', async () => {
        const db = createThreadDb()

        await invalidateThreadSourceOnChatDelete({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            chatId: 'private-topic',
            data: { type: 'topics', isPublicFor: ['owner'] },
        })
        expect(db.queries).toHaveLength(0)

        const result = await invalidateThreadSourceOnChatDelete({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            chatId: 't1',
            data: { type: 'tasks', isPublicFor: ['owner'] },
        })
        expect(result).toEqual({ pages: 1, redactedRevisions: 0 })
        expect(db.read(pagePath('release'))).toMatchObject({ needsRebuildReason: 'deleted' })
    })
})

// Hiding is a property of the views, and members may read the whole wiki tree from Firestore, so a
// withdrawn source must also leave the stored text: the page, its label, and every revision.
describe('removing what a withdrawn source contributed', () => {
    const revisionPath = (slug, revision) => `${pagePath(slug)}/revisions/${String(revision).padStart(6, '0')}`
    const PRIVATE_LINE = 'Acme pays 120 EUR per hour'

    function createDbWithHistory() {
        return new KnowledgeFirestoreDouble({
            [KB_PATH]: { enabled: true, nextRunAt: NOW + 3_600_000 },
            [pagePath('kunden')]: {
                title: 'Kunden und Preise',
                summary: 'Who pays what',
                body: `${PRIVATE_LINE} [[task:t1]]. Beta is new [[contact:c1]].`,
                revision: 2,
                sourceKeys: ['task:t1', 'contact:c1'],
                historicalSourceKeys: ['task:t1', 'contact:c1'],
                sourceLabels: { 'task:t1': 'Acme rate', 'contact:c1': 'Beta GmbH' },
            },
            [revisionPath('kunden', 1)]: {
                revision: 1,
                title: 'Kunden',
                body: `${PRIVATE_LINE} [[task:t1]].`,
                reason: 'Added the Acme rate',
                sourceKeys: ['task:t1'],
            },
            [revisionPath('kunden', 2)]: {
                revision: 2,
                title: 'Kunden und Preise',
                body: `${PRIVATE_LINE} [[task:t1]]. Beta is new [[contact:c1]].`,
                reason: 'Added Beta',
                sourceKeys: ['task:t1', 'contact:c1'],
            },
            // Stopped citing the task in revision 2, but revision 1 still repeats it.
            [pagePath('preise')]: {
                title: 'Preise',
                body: 'Rates are agreed per customer [[note:n1]].',
                revision: 2,
                sourceKeys: ['note:n1'],
                historicalSourceKeys: ['task:t1', 'note:n1'],
            },
            [revisionPath('preise', 1)]: {
                revision: 1,
                title: 'Preise',
                body: `${PRIVATE_LINE} [[task:t1]].`,
                sourceKeys: ['task:t1'],
            },
            [revisionPath('preise', 2)]: {
                revision: 2,
                title: 'Preise',
                body: 'Rates are agreed per customer [[note:n1]].',
                sourceKeys: ['note:n1'],
            },
        })
    }

    const makePrivate = db =>
        invalidateKnowledgeSourcesOnUpdate({
            db,
            fieldValue,
            now: NOW,
            projectId: PROJECT_ID,
            objectType: 'tasks',
            objectId: 't1',
            before: { isPublicFor: [0, 'owner'] },
            after: { isPublicFor: ['owner'] },
        })

    const storedText = db =>
        JSON.stringify([...db.documents.entries()].filter(([path]) => path.startsWith(`${KB_PATH}/`)))

    it('leaves nothing of the source in any page or revision', async () => {
        const db = createDbWithHistory()
        expect(storedText(db)).toContain(PRIVATE_LINE)

        const result = await makePrivate(db)

        expect(result).toEqual({ pages: 1, redactedRevisions: 3 })
        expect(storedText(db)).not.toContain(PRIVATE_LINE)
        expect(storedText(db)).not.toContain('Acme rate')
    })

    it('empties the page that cites the source and keeps the labels of the sources it still has', async () => {
        const db = createDbWithHistory()

        await makePrivate(db)

        const page = db.read(pagePath('kunden'))
        expect(page.title).toBeUndefined()
        expect(page.summary).toBeUndefined()
        expect(page.body).toBeUndefined()
        expect(page).toMatchObject({
            needsRebuild: true,
            sourceKeys: ['contact:c1'],
            historicalSourceKeys: ['contact:c1'],
            sourceLabels: { 'contact:c1': 'Beta GmbH' },
        })
        expect(db.read(revisionPath('kunden', 2))).toEqual({
            revision: 2,
            sourceKeys: ['task:t1', 'contact:c1'],
            redacted: true,
            redactedAt: NOW,
            redactedReason: 'privacy',
        })
    })

    it('redacts old revisions of a page that no longer cites the source without hiding the page', async () => {
        const db = createDbWithHistory()

        await makePrivate(db)

        const page = db.read(pagePath('preise'))
        expect(isKnowledgePageVisible(page)).toBe(true)
        expect(page.body).toBe('Rates are agreed per customer [[note:n1]].')
        expect(page.historicalSourceKeys).toEqual(['note:n1'])
        expect(db.read(revisionPath('preise', 1))).toMatchObject({ redacted: true })
        expect(db.read(revisionPath('preise', 1)).body).toBeUndefined()
        expect(db.read(revisionPath('preise', 2)).redacted).toBeUndefined()
    })

    it('removes the text of an archived page without scheduling a rebuild for it', async () => {
        const db = new KnowledgeFirestoreDouble({
            [KB_PATH]: { enabled: true, nextRunAt: NOW + 3_600_000 },
            [pagePath('alt')]: {
                title: 'Alt',
                body: `${PRIVATE_LINE} [[task:t1]].`,
                archived: true,
                sourceKeys: ['task:t1'],
            },
        })

        const result = await makePrivate(db)

        expect(result).toEqual({ pages: 0, redactedRevisions: 0 })
        expect(storedText(db)).not.toContain(PRIVATE_LINE)
        expect(db.read(pagePath('alt')).needsRebuild).toBeUndefined()
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 3_600_000)
    })
})
