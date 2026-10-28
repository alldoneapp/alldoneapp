const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    CONTRIBUTION_DRAFTS_COLLECTION,
    CONTRIBUTION_DRAFT_TTL_MS,
    findForbiddenContent,
    getConfirmationReasons,
    listKnowledgeContributions,
    removeKnowledgeContribution,
    saveKnowledgeContribution,
} = require('./knowledgeContributions')
const {
    buildContributionCard,
    collectKnowledgeSources,
    loadKnowledgeSourcesByKeys,
} = require('./collectKnowledgeSources')

const PROJECT_ID = 'project-a'
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const NOW = 1_800_000_000_000

function createDb(extra = {}) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { name: 'Alldone Product', userIds: ['member'] },
        ['users/member']: { displayName: 'Karsten' },
        [KB_PATH]: { enabled: true, ownerUserId: 'member', nextRunAt: NOW + 60 * 60 * 1000 },
        ...extra,
    })
}

const conversation = (overrides = {}) => ({
    projectId: PROJECT_ID,
    objectType: 'tasks',
    objectId: 'task-1',
    messageId: 'message-1',
    sourceChannel: null,
    ...overrides,
})

function save(db, args, { context = conversation(), now = NOW, enqueue = jest.fn(async () => {}) } = {}) {
    return saveKnowledgeContribution({
        db,
        projectId: PROJECT_ID,
        userId: 'member',
        assistantId: 'anna',
        args,
        toolRuntimeContext: context,
        enqueue,
        now,
    })
}

const contributions = db => [...db.documents.entries()].filter(([path]) => path.startsWith(`${KB_PATH}/contributions/`))
const drafts = db =>
    [...db.documents.entries()].filter(([path]) => path.startsWith(`${CONTRIBUTION_DRAFTS_COLLECTION}/`))

describe('saving knowledge from a conversation', () => {
    it("saves the member's own words straight away and asks for a run", async () => {
        const db = createDb()
        const enqueue = jest.fn(async () => {})

        const result = await save(
            db,
            {
                text: 'Der Paketpreis bleibt gleich; offen ist nur die Credit-Menge.',
                origin: 'user_statement',
                mayContainPrivateInformation: false,
            },
            { enqueue }
        )

        expect(result).toMatchObject({
            success: true,
            projectId: PROJECT_ID,
            title: 'Der Paketpreis bleibt gleich; offen ist nur die Credit-Menge.',
        })
        const [[path, stored]] = contributions(db)
        expect(path).toBe(`${KB_PATH}/contributions/${result.contributionId}`)
        expect(stored).toMatchObject({
            text: 'Der Paketpreis bleibt gleich; offen ist nur die Credit-Menge.',
            origin: 'user_statement',
            status: 'active',
            addedBy: 'member',
            authorName: 'Karsten',
            confirmation: 'direct',
            confirmationReasons: [],
            sourceProjectId: PROJECT_ID,
            objectType: 'tasks',
            objectId: 'task-1',
            messageId: 'message-1',
            lastEditionDate: NOW,
        })
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW)
        expect(enqueue).toHaveBeenCalledWith({ projectId: PROJECT_ID, dueAt: NOW, trigger: 'contribution' })
        expect(drafts(db)).toHaveLength(0)
    })

    it('keeps an ambiguous text out of the wiki until the member confirms it in a later message', async () => {
        const db = createDb()
        const draft = await save(db, {
            text: 'Zusammenfassung: Juno startet im November mit drei Paketen.',
            title: 'Juno-Start',
            origin: 'assistant_summary',
            mayContainPrivateInformation: true,
        })

        expect(draft).toMatchObject({
            success: true,
            saved: false,
            needsConfirmation: true,
            textToShare: 'Zusammenfassung: Juno startet im November mit drei Paketen.',
            reasons: ['assistant_summary', 'may_contain_private_information'],
        })
        expect(draft.note).toMatch(/NOT saved yet/)
        // Nothing in the wiki tree, which every member can read straight from Firestore.
        expect(contributions(db)).toHaveLength(0)
        expect(drafts(db)).toHaveLength(1)
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 60 * 60 * 1000)

        // The same turn cannot confirm its own draft.
        await expect(save(db, { draftId: draft.draftId, confirmed: true })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/has not answered yet/),
        })
        // A later message without an explicit confirmation does not either.
        const later = { context: conversation({ messageId: 'message-2' }) }
        await expect(save(db, { draftId: draft.draftId }, later)).resolves.toMatchObject({ success: false })

        const saved = await save(db, { draftId: draft.draftId, confirmed: true }, later)
        expect(saved).toMatchObject({ success: true, title: 'Juno-Start' })
        expect(contributions(db)[0][1]).toMatchObject({
            origin: 'assistant_summary',
            confirmation: 'confirmed',
            confirmationReasons: ['assistant_summary', 'may_contain_private_information'],
        })
        expect(drafts(db)).toHaveLength(0)
        await expect(save(db, { draftId: draft.draftId, confirmed: true }, later)).resolves.toMatchObject({
            success: false,
        })
    })

    it("asks first when the text goes into another project's wiki than the conversation's", () => {
        expect(
            getConfirmationReasons({
                origin: 'user_statement',
                mayContainPrivateInformation: false,
                projectId: 'project-a',
                conversationProjectId: 'project-b',
            })
        ).toEqual(['other_project'])
    })

    it('only lets the member who made a draft confirm it, and not after it expired', async () => {
        const db = createDb()
        const draft = await save(db, {
            text: 'Etwas.',
            origin: 'assistant_summary',
            mayContainPrivateInformation: false,
        })
        const later = conversation({ messageId: 'message-2' })

        await expect(
            saveKnowledgeContribution({
                db,
                projectId: PROJECT_ID,
                userId: 'someone-else',
                args: { draftId: draft.draftId, confirmed: true },
                toolRuntimeContext: later,
                enqueue: async () => {},
                now: NOW,
            })
        ).resolves.toMatchObject({ success: false })
        await expect(
            save(
                db,
                { draftId: draft.draftId, confirmed: true },
                { context: later, now: NOW + CONTRIBUTION_DRAFT_TTL_MS + 1 }
            )
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/expired/) })
        expect(drafts(db)).toHaveLength(0)
    })

    it('confirms over MCP, which has no message ids, with an explicit confirmation', async () => {
        const db = createDb()
        const mcp = { context: { projectId: PROJECT_ID, sourceChannel: 'mcp', mcpClient: 'Claude' } }
        const draft = await save(
            db,
            { text: 'Ein Fazit.', origin: 'assistant_summary', mayContainPrivateInformation: false },
            mcp
        )
        const saved = await save(db, { draftId: draft.draftId, confirmed: true }, mcp)
        expect(saved).toMatchObject({ success: true })
        expect(contributions(db)[0][1]).toMatchObject({ sourceChannel: 'mcp', via: 'mcp', viaClient: 'Claude' })
    })

    it('refuses what must never be on a wiki page, and validates every flag', async () => {
        const db = createDb()
        await expect(
            save(db, {
                text: 'Ansprechpartner: anna@example.com, +49 30 1234567',
                origin: 'user_statement',
                mayContainPrivateInformation: false,
            })
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/email address or a phone number/) })
        expect(findForbiddenContent('api_key: sk-abcdefghijklmnopqrstuvwx')).toEqual(['a password, key or token'])
        expect(findForbiddenContent('Release am 2026-10-28, Version 1.2.3, 150 Credits.')).toEqual([])
        await expect(
            save(db, { text: 'x', origin: 'guess', mayContainPrivateInformation: false })
        ).resolves.toMatchObject({
            success: false,
        })
        await expect(save(db, { text: 'x', origin: 'user_statement' })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/when you are not sure, it is true/),
        })
        await expect(
            save(db, { text: 'x'.repeat(4001), origin: 'user_statement', mayContainPrivateInformation: false })
        ).resolves.toMatchObject({ success: false })
        expect(contributions(db)).toHaveLength(0)
    })

    it('saves nothing to a wiki that is switched off, and nothing twice', async () => {
        const off = createDb({ [KB_PATH]: { enabled: false } })
        const args = { text: 'Gleicher Text.', origin: 'user_statement', mayContainPrivateInformation: false }
        await expect(save(off, args)).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/switched off/),
        })

        const db = createDb()
        const first = await save(db, args)
        await expect(save(db, args)).resolves.toMatchObject({
            success: true,
            alreadySaved: true,
            contributionId: first.contributionId,
        })
        expect(contributions(db)).toHaveLength(1)
    })
})

describe('a saved contribution as a wiki source', () => {
    it('is cited like any source and is marked as a member statement, not a verified record', async () => {
        const db = createDb()
        const { contributionId } = await save(db, {
            text: 'Wir verkaufen Credits in Paketen.',
            origin: 'user_statement',
            mayContainPrivateInformation: false,
        })
        const [card] = await loadKnowledgeSourcesByKeys({
            db,
            projectId: PROJECT_ID,
            keys: [`contribution:${contributionId}`],
        })
        expect(card.key).toBe(`contribution:${contributionId}`)
        expect(card.text).toContain(`[[contribution:${contributionId}]]`)
        expect(card.text).toContain('saved to the wiki by Karsten')
        expect(card.text).toContain('not verified against project records')
        expect(buildContributionCard('c1', { text: 'x', origin: 'assistant_summary' }).text).toContain(
            "an assistant's summary of the conversation, which the member confirmed"
        )
    })

    it('reaches the next ingest through the delta, unless it was removed', async () => {
        const db = createDb({
            [`${KB_PATH}/contributions/removed1`]: { title: 'Weg', status: 'removed', lastEditionDate: NOW - 5 },
        })
        const { contributionId } = await save(db, {
            text: 'Neue Erkenntnis.',
            origin: 'user_statement',
            mayContainPrivateInformation: false,
        })

        const collected = await collectKnowledgeSources({
            db,
            projectId: PROJECT_ID,
            cursor: {},
            now: NOW + 1000,
            readNoteContent: async () => '',
            readThreadComments: async () => [],
            readArtifactContent: async () => '',
            resolveUserNames: async () => ({}),
            resolveAssistantNames: async () => ({}),
        })

        expect(collected.sources.map(source => source.key)).toEqual([`contribution:${contributionId}`])
        expect(collected.nextCursor.contributions).toEqual({ ms: NOW, ids: [contributionId] })
        expect(collected.stats.skipped).toEqual({ private: 1 })
    })

    it('is listed for the read tool and withdrawn from every page that used it', async () => {
        const db = createDb()
        const { contributionId } = await save(db, {
            text: 'Wir verkaufen Credits in Paketen.',
            origin: 'user_statement',
            mayContainPrivateInformation: false,
        })
        const key = `contribution:${contributionId}`
        db.write(`${KB_PATH}/pages/preise`, {
            title: 'Preise',
            body: `Credits kommen in Paketen [[${key}]].`,
            sourceKeys: [key],
            historicalSourceKeys: [key],
            archived: false,
            needsRebuild: false,
        })
        await expect(listKnowledgeContributions(db, PROJECT_ID)).resolves.toEqual([
            expect.objectContaining({ contributionId, savedBy: 'Karsten', origin: 'user_statement' }),
        ])

        const result = await removeKnowledgeContribution({
            db,
            projectId: PROJECT_ID,
            userId: 'member',
            contributionId,
            now: NOW,
            fieldValue,
        })

        expect(result).toMatchObject({ success: true, pagesToRebuild: 1 })
        expect(db.read(`${KB_PATH}/contributions/${contributionId}`)).toMatchObject({ status: 'removed' })
        expect(db.read(`${KB_PATH}/contributions/${contributionId}`)).not.toHaveProperty('text')
        expect(db.read(`${KB_PATH}/pages/preise`)).toMatchObject({ needsRebuild: true, removedSourceKeys: [key] })
        expect(db.read(`${KB_PATH}/pages/preise`)).not.toHaveProperty('body')
        await expect(loadKnowledgeSourcesByKeys({ db, projectId: PROJECT_ID, keys: [key] })).resolves.toEqual([])
        await expect(listKnowledgeContributions(db, PROJECT_ID)).resolves.toEqual([])
    })
})
