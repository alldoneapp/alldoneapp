const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    _resetKnowledgeBaseAvailabilityCacheForTests,
    canCorrectKnowledgeBaseOnChannel,
    executeKnowledgeBaseTool,
    getKnowledgeBaseContextMessage,
    getKnowledgeBaseToolNamesForRun,
    resolveKnowledgeBaseAccess,
    undoKnowledgeCorrection,
} = require('./knowledgeBaseAssistant')
const {
    ADD_KNOWLEDGE_DOCUMENT_TOOL,
    CORRECT_KNOWLEDGE_PAGE_TOOL,
    READ_KNOWLEDGE_PAGE_TOOL,
    REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL,
    REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
    SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
    SEARCH_KNOWLEDGE_TOOL,
    UNDO_KNOWLEDGE_CORRECTION_TOOL,
} = require('./knowledgeBaseToolSchemas')

const PROJECT_ID = 'project-a'
const NOW = 1_800_000_000_000
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const pagePath = slug => `${KB_PATH}/pages/${slug}`
const revisionPath = (slug, revision) => `${pagePath(slug)}/revisions/${String(revision).padStart(6, '0')}`

const KUNDEN_BODY = 'Acme ist Pilotkunde [[task:t1]]. Ansprechpartnerin ist Frau Berg [[contact:c1]].'

function createDb(extra = {}) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { name: 'Alldone Product', userIds: ['member', 'teammate'] },
        ['projects/project-b']: { name: 'Other', userIds: ['someone-else'] },
        ['users/member']: { displayName: 'Karsten' },
        ['users/teammate']: { displayName: 'Ulla' },
        [KB_PATH]: { enabled: true, ownerUserId: 'member' },
        [pagePath('kunden')]: {
            title: 'Kunden',
            summary: 'Wer unsere Kunden sind.',
            body: KUNDEN_BODY,
            revision: 2,
            sourceKeys: ['task:t1', 'contact:c1'],
            historicalSourceKeys: ['task:t1', 'contact:c1'],
            sourceLabels: { 'task:t1': 'Acme gewinnen', 'contact:c1': 'Frau Berg' },
            archived: false,
            needsRebuild: false,
        },
        [revisionPath('kunden', 2)]: { revision: 2, title: 'Kunden', body: KUNDEN_BODY, sourceKeys: ['task:t1'] },
        [pagePath('entscheidungen')]: {
            title: 'Entscheidungen',
            summary: 'Was beschlossen wurde.',
            body: 'Wir starten im März [[note:n1]].',
            revision: 1,
            sourceKeys: ['note:n1'],
            archived: false,
            needsRebuild: false,
        },
        [pagePath('geheim')]: {
            needsRebuild: true,
            archived: false,
            revision: 4,
            sourceKeys: [],
        },
        [pagePath('alt')]: { title: 'Alt', archived: true, needsRebuild: false, revision: 3 },
        ...extra,
    })
}

const chatRun = (overrides = {}) => ({
    projectId: PROJECT_ID,
    requestUserId: 'member',
    assistantId: 'anna',
    allowKnowledgeCorrections: true,
    objectType: 'topics',
    objectId: 'chat-1',
    ...overrides,
})

function run(db, toolName, args, context = chatRun()) {
    return executeKnowledgeBaseTool({
        db,
        toolName,
        args,
        assistantId: 'anna',
        toolRuntimeContext: context,
        now: NOW,
        fieldValue,
    })
}

beforeEach(() => _resetKnowledgeBaseAvailabilityCacheForTests())

describe('resolveKnowledgeBaseAccess', () => {
    it('lets a member read, and correct only when they are talking to the assistant directly', () => {
        expect(resolveKnowledgeBaseAccess(chatRun({ allowKnowledgeCorrections: undefined }))).toBe('read')
        expect(resolveKnowledgeBaseAccess(chatRun())).toBe('correct')
    })

    it('gives nothing to runs without a person, or on channels that carry untrusted mail', () => {
        expect(resolveKnowledgeBaseAccess(null)).toBe('none')
        expect(resolveKnowledgeBaseAccess({ projectId: PROJECT_ID })).toBe('none')
        expect(resolveKnowledgeBaseAccess(chatRun({ channel: 'email' }))).toBe('none')
        expect(resolveKnowledgeBaseAccess(chatRun({ sourceChannel: 'email' }))).toBe('none')
        expect(resolveKnowledgeBaseAccess(chatRun({ gmailContext: { messageId: 'm1' } }))).toBe('none')
        // The writing router is a bare model call without an assistant, and so without tools.
        expect(resolveKnowledgeBaseAccess(chatRun({ assistantId: undefined, writingDraft: true }))).toBe('none')
    })

    it('lets the app and WhatsApp correct, but not a phone call known only by its caller ID', () => {
        expect(canCorrectKnowledgeBaseOnChannel('browser_call')).toBe(true)
        expect(canCorrectKnowledgeBaseOnChannel('whatsapp')).toBe(true)
        expect(canCorrectKnowledgeBaseOnChannel('whatsapp_call')).toBe(true)
        expect(canCorrectKnowledgeBaseOnChannel('phone_call')).toBe(false)
        expect(canCorrectKnowledgeBaseOnChannel('email')).toBe(false)
        expect(canCorrectKnowledgeBaseOnChannel(undefined)).toBe(false)
    })

    it('lets writing mode read but never write', () => {
        expect(resolveKnowledgeBaseAccess(chatRun({ writingDraft: true }))).toBe('read')
    })

    it('lets an MCP client, which acts for the signed-in member without an assistant, read and correct', () => {
        const mcpCall = { projectId: PROJECT_ID, requestUserId: 'member', assistantId: null, sourceChannel: 'mcp' }
        expect(resolveKnowledgeBaseAccess(mcpCall)).toBe('correct')
        expect(resolveKnowledgeBaseAccess({ ...mcpCall, projectId: null })).toBe('none')
        expect(resolveKnowledgeBaseAccess({ ...mcpCall, requestUserId: null })).toBe('none')
        // Any other assistant-less context still gets nothing.
        expect(resolveKnowledgeBaseAccess({ ...mcpCall, sourceChannel: 'whatsapp' })).toBe('none')
    })
})

describe('getKnowledgeBaseContextMessage', () => {
    it('lists the visible pages for a member, reading only the fields the index needs', async () => {
        const db = createDb()

        const message = await getKnowledgeBaseContextMessage({ db, context: chatRun() })

        expect(message).toContain('Project wiki of "Alldone Product"')
        expect(message).toContain(`Project ID: ${PROJECT_ID}`)
        expect(message).toContain('- [[entscheidungen]] Entscheidungen — Was beschlossen wurde.')
        expect(message).toContain('- [[kunden]] Kunden — Wer unsere Kunden sind.')
        expect(message).not.toContain('geheim')
        expect(message).not.toContain('[[alt]]')
        expect(message).not.toContain('Pilotkunde')
        const pagesQuery = db.queries.find(query => query.collectionPath === `${KB_PATH}/pages`)
        expect(pagesQuery.select).not.toContain('body')
    })

    it('only describes the correction tools to a run that may correct', async () => {
        const db = createDb()

        const reading = await getKnowledgeBaseContextMessage({
            db,
            context: chatRun({ allowKnowledgeCorrections: false }),
        })
        const correcting = await getKnowledgeBaseContextMessage({ db, context: chatRun() })

        expect(reading).toContain(READ_KNOWLEDGE_PAGE_TOOL)
        expect(reading).not.toContain(CORRECT_KNOWLEDGE_PAGE_TOOL)
        expect(correcting).toContain(CORRECT_KNOWLEDGE_PAGE_TOOL)
        expect(correcting).toContain(UNDO_KNOWLEDGE_CORRECTION_TOOL)
    })

    it('tells the assistant what the wiki is built from and how fresh it is', async () => {
        const db = createDb()
        db.write(
            KB_PATH,
            { lastRunAt: NOW - 1000, lastRunStatus: 'failed', lastSuccessfulRunAt: NOW - 30 * 60 * 60 * 1000 },
            {
                merge: true,
            }
        )
        const message = await getKnowledgeBaseContextMessage({ db, context: chatRun(), now: NOW })

        expect(message).toContain('comment threads and artifacts, from documents and knowledge members added to it')
        expect(message).not.toContain('updated about once a day')
        expect(message).toContain(
            `Freshness: It last caught up with its sources at ${new Date(NOW - 30 * 60 * 60 * 1000).toISOString()}`
        )
        expect(message).toContain('changes made in the project after that may not be included yet')
        expect(message).toContain(SEARCH_KNOWLEDGE_TOOL)
        expect(message).toContain(`Only when the user explicitly asks to save something from this conversation`)

        db.write(KB_PATH, { enabled: false }, { merge: true })
        const paused = await getKnowledgeBaseContextMessage({ db, context: chatRun(), now: NOW })
        expect(paused).toContain('It is switched off and is not being updated.')
    })

    it('keeps project selection and wiki-first research instructions when the chat has no wiki', async () => {
        const db = createDb()
        db.documents.delete(KB_PATH)
        const message = await getKnowledgeBaseContextMessage({ db, context: chatRun() })

        expect(message).toContain('PROJECT KNOWLEDGE — WIKI FIRST')
        expect(message).toContain('get_user_projects')
        expect(message).toContain('SAME projectId')
        expect(message).not.toContain('Pages:')
        expect(message).not.toContain(CORRECT_KNOWLEDGE_PAGE_TOOL)
        expect(db.queries.filter(query => query.collectionPath !== 'knowledgeContributionDrafts')).toHaveLength(0)
    })

    it('says nothing to someone outside the project or on the email channel', async () => {
        await expect(
            getKnowledgeBaseContextMessage({ db: createDb(), context: chatRun({ requestUserId: 'stranger' }) })
        ).resolves.toBe('')
        await expect(
            getKnowledgeBaseContextMessage({ db: createDb(), context: chatRun({ channel: 'email' }) })
        ).resolves.toBe('')
        await expect(
            getKnowledgeBaseContextMessage({ db: createDb(), context: chatRun({ projectId: 'project-b' }) })
        ).resolves.toBe('')
    })
})

describe('getKnowledgeBaseToolNamesForRun', () => {
    it('offers reading to every member run and correcting only to a direct conversation', async () => {
        const db = createDb()

        await expect(
            getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: chatRun({ allowKnowledgeCorrections: false }) })
        ).resolves.toEqual([READ_KNOWLEDGE_PAGE_TOOL, SEARCH_KNOWLEDGE_TOOL])
        await expect(getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: chatRun() })).resolves.toEqual([
            READ_KNOWLEDGE_PAGE_TOOL,
            SEARCH_KNOWLEDGE_TOOL,
            CORRECT_KNOWLEDGE_PAGE_TOOL,
            UNDO_KNOWLEDGE_CORRECTION_TOOL,
            ADD_KNOWLEDGE_DOCUMENT_TOOL,
            REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
            SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
            REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL,
        ])
    })

    it('offers a writing run only wiki tools the writing executor will run', async () => {
        const { WRITING_READ_TOOLS } = require('../Assistant/assistantWritingTools')
        const db = createDb()

        // writingAssistant.js refuses any tool outside WRITING_READ_TOOLS and that refusal ends
        // the whole draft, so a tool offered here but missing there fails the menubar request.
        const offered = await getKnowledgeBaseToolNamesForRun({
            db,
            toolRuntimeContext: chatRun({ writingDraft: true }),
        })
        expect(offered).toEqual([READ_KNOWLEDGE_PAGE_TOOL, SEARCH_KNOWLEDGE_TOOL])
        offered.forEach(toolName => expect(WRITING_READ_TOOLS.has(toolName)).toBe(true))
    })

    it('keeps reading other project wikis available while the chat wiki is being rebuilt', async () => {
        const db = new KnowledgeFirestoreDouble({
            [`projects/${PROJECT_ID}`]: { userIds: ['member'] },
            [KB_PATH]: { enabled: true },
            [pagePath('geheim')]: { needsRebuild: true, archived: false },
        })

        // A new wiki's first content is often a deck: adding one must not wait for a first page.
        await expect(getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: chatRun() })).resolves.toEqual([
            READ_KNOWLEDGE_PAGE_TOOL,
            SEARCH_KNOWLEDGE_TOOL,
            ADD_KNOWLEDGE_DOCUMENT_TOOL,
            REMOVE_KNOWLEDGE_DOCUMENT_TOOL,
            SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
            REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL,
        ])
        _resetKnowledgeBaseAvailabilityCacheForTests()
        await expect(
            getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: chatRun({ allowKnowledgeCorrections: false }) })
        ).resolves.toEqual([READ_KNOWLEDGE_PAGE_TOOL, SEARCH_KNOWLEDGE_TOOL])
    })

    it('offers reading without a local wiki, but never to a nonmember or the email channel', async () => {
        const db = createDb()
        db.documents.delete(KB_PATH)
        for (const context of [chatRun(), chatRun({ writingDraft: true })]) {
            await expect(getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: context })).resolves.toEqual([
                READ_KNOWLEDGE_PAGE_TOOL,
                SEARCH_KNOWLEDGE_TOOL,
            ])
        }
        for (const context of [chatRun({ requestUserId: 'stranger' }), chatRun({ channel: 'email' })]) {
            await expect(getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: context })).resolves.toEqual([])
        }
    })

    it('offers no document tools for a wiki that is switched off, though its pages stay readable', async () => {
        const db = createDb({ [KB_PATH]: { enabled: false, ownerUserId: 'member' } })

        await expect(getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: chatRun() })).resolves.toEqual([
            READ_KNOWLEDGE_PAGE_TOOL,
            SEARCH_KNOWLEDGE_TOOL,
            CORRECT_KNOWLEDGE_PAGE_TOOL,
            UNDO_KNOWLEDGE_CORRECTION_TOOL,
        ])
    })

    it('asks Firestore at most every 30 seconds per project and person', async () => {
        const db = new KnowledgeFirestoreDouble({ [`projects/${PROJECT_ID}`]: { userIds: ['member'] } })
        const ask = now => getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: chatRun(), now })

        await expect(ask(NOW)).resolves.toEqual([READ_KNOWLEDGE_PAGE_TOOL, SEARCH_KNOWLEDGE_TOOL])
        db.write(KB_PATH, { enabled: true })
        db.write(pagePath('kunden'), { title: 'Kunden', archived: false, needsRebuild: false })
        await expect(ask(NOW + 10_000)).resolves.toEqual([READ_KNOWLEDGE_PAGE_TOOL, SEARCH_KNOWLEDGE_TOOL])
        await expect(ask(NOW + 31_000)).resolves.toHaveLength(8)
    })
})

describe('read_knowledge_page', () => {
    it('reads the chosen project index and page from a chat without a wiki, rechecking target membership', async () => {
        const db = createDb({
            'projects/jtl': { name: 'JTL Software - Project Juno', userIds: ['member'] },
            'knowledgeBases/jtl': { enabled: true },
            'knowledgeBases/jtl/pages/connect': {
                title: 'JTL Connect',
                body: 'Slides came from the presentation team.',
                archived: false,
                needsRebuild: false,
            },
        })
        db.documents.delete(KB_PATH)
        const offered = await getKnowledgeBaseToolNamesForRun({ db, toolRuntimeContext: chatRun() })
        expect(offered).toContain(READ_KNOWLEDGE_PAGE_TOOL)
        const index = await run(db, READ_KNOWLEDGE_PAGE_TOOL, { projectId: 'jtl' })
        expect(index).toMatchObject({ projectId: 'jtl', pages: [{ slug: 'connect', title: 'JTL Connect' }] })
        await expect(
            run(db, READ_KNOWLEDGE_PAGE_TOOL, { projectId: 'jtl', slug: index.pages[0].slug })
        ).resolves.toMatchObject({ projectId: 'jtl', body: 'Slides came from the presentation team.' })

        // Returning an index never grants ongoing access to the target project's pages.
        db.write('projects/jtl', { userIds: ['someone-else'] }, { merge: true })
        await expect(run(db, READ_KNOWLEDGE_PAGE_TOOL, { projectId: 'jtl', slug: 'connect' })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/members/),
        })
    })

    it('returns the page with its revision and labelled sources', async () => {
        const result = await run(createDb(), READ_KNOWLEDGE_PAGE_TOOL, { slug: 'kunden' })

        expect(result).toMatchObject({
            success: true,
            slug: 'kunden',
            title: 'Kunden',
            body: KUNDEN_BODY,
            revision: 2,
            sources: [
                { key: 'task:t1', label: 'Acme gewinnen' },
                { key: 'contact:c1', label: 'Frau Berg' },
            ],
        })
    })

    it('returns only the sources the text cites and counts the others, which stay on the page', async () => {
        const db = createDb()
        db.write(
            pagePath('kunden'),
            {
                sourceKeys: ['task:t1', 'contact:c1', 'note:old1', 'task:old2'],
                sourceLabels: { 'task:t1': 'Acme gewinnen', 'contact:c1': 'Frau Berg', 'note:old1': 'Alte Notiz' },
            },
            { merge: true }
        )

        const result = await run(db, READ_KNOWLEDGE_PAGE_TOOL, { slug: 'kunden' })

        expect(result.sources).toEqual([
            { key: 'task:t1', label: 'Acme gewinnen' },
            { key: 'contact:c1', label: 'Frau Berg' },
        ])
        expect(result.otherSourceCount).toBe(2)
        expect(JSON.stringify(result)).not.toContain('Alte Notiz')
        expect(result.note).toContain('2 other source(s) it no longer cites')
        // The full provenance is untouched: the privacy withdrawal still finds the page by it.
        expect(db.read(pagePath('kunden')).sourceKeys).toHaveLength(4)
    })

    it('says when the wiki last caught up, on a page and in the index', async () => {
        const db = createDb()
        db.write(KB_PATH, { lastSuccessfulRunAt: NOW - 5 * 60 * 60 * 1000 }, { merge: true })

        const pageRead = await run(db, READ_KNOWLEDGE_PAGE_TOOL, { slug: 'kunden' })
        const index = await run(db, READ_KNOWLEDGE_PAGE_TOOL, {})

        const iso = new Date(NOW - 5 * 60 * 60 * 1000).toISOString()
        expect(pageRead.wikiLastUpdatedAt).toBe(iso)
        expect(pageRead.note).toContain(`last caught up with its sources at ${iso} (about 5 hours ago)`)
        expect(pageRead.note).toContain('may not be included yet')
        expect(index).toMatchObject({ wikiLastUpdatedAt: iso, freshness: expect.stringMatching(/about 5 hours ago/) })
    })

    it('lists every visible page and the documents in the wiki when no slug is given', async () => {
        const db = createDb({
            [`${KB_PATH}/documents/d1`]: {
                title: 'Pricing concept',
                fileName: 'pricing.pptx',
                authorName: 'Karsten',
                createdAt: NOW,
                status: 'active',
                text: 'Team costs 12 euros.',
            },
            [`${KB_PATH}/documents/d2`]: { title: 'Old deck', status: 'removed', createdAt: NOW - 1 },
        })
        const result = await run(db, READ_KNOWLEDGE_PAGE_TOOL, {})

        expect(result.pages.map(page => page.slug)).toEqual(['entscheidungen', 'kunden'])
        expect(result.documents).toEqual([
            {
                documentId: 'd1',
                title: 'Pricing concept',
                fileName: 'pricing.pptx',
                addedBy: 'Karsten',
                addedAt: new Date(NOW).toISOString(),
            },
        ])
        // The listing never downloads a document's text.
        expect(db.queries.find(query => query.collectionPath === `${KB_PATH}/documents`).select).not.toContain('text')
    })

    it('refuses a page waiting for a rebuild, an archived page and another project it is no member of', async () => {
        const db = createDb()

        await expect(run(db, READ_KNOWLEDGE_PAGE_TOOL, { slug: 'geheim' })).resolves.toMatchObject({ success: false })
        await expect(run(db, READ_KNOWLEDGE_PAGE_TOOL, { slug: 'alt' })).resolves.toMatchObject({ success: false })
        await expect(
            run(db, READ_KNOWLEDGE_PAGE_TOOL, { slug: 'kunden', projectId: 'project-b' })
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/members/) })
    })

    it('reads nothing for the email channel even if the call reaches it', async () => {
        await expect(
            run(createDb(), READ_KNOWLEDGE_PAGE_TOOL, { slug: 'kunden' }, chatRun({ channel: 'email' }))
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/not permitted/) })
    })
})

describe('correct_knowledge_page', () => {
    const correction = {
        slug: 'kunden',
        revision: 2,
        correction: 'Die Ansprechpartnerin heißt Frau Brandt, nicht Frau Berg.',
        body: 'Acme ist Pilotkunde [[task:t1]]. Ansprechpartnerin ist Frau Brandt [[correction:new]].',
    }

    it('applies the correction as a new revision and keeps it as a source of its own', async () => {
        const db = createDb()

        const result = await run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, correction)

        expect(result).toMatchObject({ success: true, slug: 'kunden', revision: 3 })
        const correctionKey = `correction:${result.correctionId}`
        const page = db.read(pagePath('kunden'))
        expect(page.body).toBe(
            `Acme ist Pilotkunde [[task:t1]]. Ansprechpartnerin ist Frau Brandt [[${correctionKey}]].`
        )
        expect(page.sourceKeys).toEqual(['task:t1', 'contact:c1', correctionKey])
        expect(page.sourceLabels[correctionKey]).toBe('Correction by Karsten')
        expect(page.updatedBy).toBe('member')
        expect(db.read(`${KB_PATH}/corrections/${result.correctionId}`)).toEqual({
            text: correction.correction,
            authorUserId: 'member',
            authorName: 'Karsten',
            assistantId: 'anna',
            pageSlug: 'kunden',
            status: 'applied',
            revisionBefore: 2,
            revisionAfter: 3,
            objectType: 'topics',
            objectId: 'chat-1',
            sourceChannel: null,
            createdAt: NOW,
        })
        expect(db.read(revisionPath('kunden', 3))).toMatchObject({
            mode: 'correction',
            reason: correction.correction,
            author: { type: 'user', userId: 'member', correctionId: result.correctionId },
        })
    })

    it('stores nothing when the page changed since it was read', async () => {
        const db = createDb()

        const result = await run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, { ...correction, revision: 1 })

        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/changed/) })
        expect(db.read(pagePath('kunden')).revision).toBe(2)
        expect([...db.documents.keys()].some(path => path.includes('/corrections/'))).toBe(false)
    })

    it('does not correct a page that is hidden or gone', async () => {
        const db = createDb()

        await expect(
            run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, { ...correction, slug: 'geheim', revision: 4 })
        ).resolves.toMatchObject({ success: false })
        await expect(
            run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, { ...correction, slug: 'alt', revision: 3 })
        ).resolves.toMatchObject({ success: false })
        await expect(
            run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, { ...correction, slug: 'neu', revision: 1 })
        ).resolves.toMatchObject({ success: false })
    })

    it('is refused for a run that only answers on the member’s behalf', async () => {
        const db = createDb()
        const unattended = chatRun({ allowKnowledgeCorrections: undefined })

        await expect(run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, correction, unattended)).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/not permitted/),
        })
        expect(db.read(pagePath('kunden')).revision).toBe(2)
    })

    it('needs the correction in the user’s words and the revision that was read', async () => {
        const db = createDb()

        await expect(run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, { ...correction, correction: ' ' })).resolves.toMatchObject({
            success: false,
        })
        await expect(
            run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, { ...correction, revision: undefined })
        ).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/read_knowledge_page/),
        })
    })
})

describe('undoing a correction', () => {
    async function correctedDb() {
        const db = createDb()
        const result = await run(db, CORRECT_KNOWLEDGE_PAGE_TOOL, {
            slug: 'kunden',
            revision: 2,
            correction: 'Frau Brandt, nicht Frau Berg.',
            body: 'Ansprechpartnerin ist Frau Brandt [[correction:new]].',
        })
        return { db, correctionId: result.correctionId }
    }

    it('restores the page as it was and retires the correction', async () => {
        const { db, correctionId } = await correctedDb()

        const result = await run(db, UNDO_KNOWLEDGE_CORRECTION_TOOL, { correctionId })

        expect(result).toMatchObject({ success: true, slug: 'kunden', revision: 4 })
        const page = db.read(pagePath('kunden'))
        expect(page.body).toBe(KUNDEN_BODY)
        expect(page.sourceKeys).toEqual(['task:t1'])
        expect(page.sourceLabels).toEqual({ 'task:t1': 'Acme gewinnen' })
        expect(db.read(`${KB_PATH}/corrections/${correctionId}`)).toMatchObject({
            status: 'reverted',
            revertedBy: 'member',
            revertRevision: 4,
        })
        expect(db.read(revisionPath('kunden', 4))).toMatchObject({ mode: 'undo', restoredRevision: 2 })
        // Made in the app's chat, not through an MCP client.
        expect(db.read(revisionPath('kunden', 3)).author).not.toHaveProperty('via')
        expect(db.read(revisionPath('kunden', 4)).author).not.toHaveProperty('via')

        await expect(run(db, UNDO_KNOWLEDGE_CORRECTION_TOOL, { correctionId })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/already undone/),
        })
    })

    it('can be done by another member from the wiki history', async () => {
        const { db, correctionId } = await correctedDb()

        const result = await undoKnowledgeCorrection({
            db,
            projectId: PROJECT_ID,
            userId: 'teammate',
            correctionId,
            now: NOW,
            fieldValue,
        })

        expect(result).toMatchObject({ success: true })
        expect(db.read(revisionPath('kunden', 4)).author).toMatchObject({ userId: 'teammate', name: 'Ulla' })
        await expect(
            undoKnowledgeCorrection({
                db,
                projectId: PROJECT_ID,
                userId: 'stranger',
                correctionId,
                now: NOW,
                fieldValue,
            })
        ).resolves.toMatchObject({ success: false })
    })

    it('leaves a page that changed after the correction alone', async () => {
        const { db, correctionId } = await correctedDb()
        db.update(pagePath('kunden'), { revision: 5, body: 'Später überarbeitet.' })

        const result = await run(db, UNDO_KNOWLEDGE_CORRECTION_TOOL, { correctionId })

        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/new correction/) })
        expect(db.read(pagePath('kunden')).body).toBe('Später überarbeitet.')
        expect(db.read(`${KB_PATH}/corrections/${correctionId}`).status).toBe('applied')
    })

    it('never brings back text a withdrawn source contributed', async () => {
        const { db, correctionId } = await correctedDb()
        // The task became private after the correction; its revisions were redacted.
        db.write(revisionPath('kunden', 2), { revision: 2, redacted: true, sourceKeys: ['task:t1'] })

        const result = await run(db, UNDO_KNOWLEDGE_CORRECTION_TOOL, { correctionId })

        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/no longer available/) })
        expect(JSON.stringify(db.read(pagePath('kunden')))).not.toContain('Pilotkunde')
    })
})

describe('over MCP', () => {
    // The context executeToolNatively builds for an MCP call: the project the MCP server resolved,
    // the OAuth-authenticated user, no assistant and no thread.
    const mcpCall = (overrides = {}) => ({
        projectId: PROJECT_ID,
        requestUserId: 'member',
        assistantId: null,
        sourceChannel: 'mcp',
        userTimezoneOffset: 120,
        language: 'de',
        objectType: null,
        objectId: null,
        ...overrides,
    })
    const mcpRun = (db, toolName, args, context = mcpCall()) =>
        executeKnowledgeBaseTool({
            db,
            toolName,
            args,
            assistantId: null,
            toolRuntimeContext: context,
            now: NOW,
            fieldValue,
        })

    it('lists and reads the pages a member may see', async () => {
        const db = createDb()

        const list = await mcpRun(db, READ_KNOWLEDGE_PAGE_TOOL, {})
        expect(list.pages.map(page => page.slug)).toEqual(['entscheidungen', 'kunden'])

        await expect(mcpRun(db, READ_KNOWLEDGE_PAGE_TOOL, { slug: 'kunden' })).resolves.toMatchObject({
            success: true,
            revision: 2,
            body: KUNDEN_BODY,
        })
        await expect(mcpRun(db, READ_KNOWLEDGE_PAGE_TOOL, { slug: 'geheim' })).resolves.toMatchObject({
            success: false,
        })
    })

    it('corrects a page in the member’s name and records that the correction came through MCP', async () => {
        const db = createDb()

        const result = await mcpRun(db, CORRECT_KNOWLEDGE_PAGE_TOOL, {
            slug: 'kunden',
            revision: 2,
            correction: 'Die Ansprechpartnerin heißt Frau Brandt.',
            body: 'Ansprechpartnerin ist Frau Brandt [[correction:new]].',
        })

        expect(result).toMatchObject({ success: true, revision: 3 })
        expect(db.read(`${KB_PATH}/corrections/${result.correctionId}`)).toMatchObject({
            authorUserId: 'member',
            authorName: 'Karsten',
            assistantId: null,
            objectType: null,
            objectId: null,
            sourceChannel: 'mcp',
            status: 'applied',
        })
        expect(db.read(revisionPath('kunden', 3)).author).toMatchObject({
            type: 'user',
            userId: 'member',
            assistantId: null,
            // The history and the Updates feed read the revision: "Karsten (via MCP)".
            via: 'mcp',
        })

        await expect(
            mcpRun(db, UNDO_KNOWLEDGE_CORRECTION_TOOL, { correctionId: result.correctionId })
        ).resolves.toMatchObject({ success: true })
        expect(db.read(pagePath('kunden')).body).toBe(KUNDEN_BODY)
        expect(db.read(revisionPath('kunden', 4)).author).toMatchObject({ userId: 'member', via: 'mcp' })
        expect(db.read(`${KB_PATH}/corrections/${result.correctionId}`).status).toBe('reverted')
    })

    it('names the MCP client on the revision when the server knows it', async () => {
        const db = createDb()

        await mcpRun(
            db,
            CORRECT_KNOWLEDGE_PAGE_TOOL,
            {
                slug: 'kunden',
                revision: 2,
                correction: 'Die Ansprechpartnerin heißt Frau Brandt.',
                body: 'Ansprechpartnerin ist Frau Brandt [[correction:new]].',
            },
            mcpCall({ mcpClient: 'Codex' })
        )

        expect(db.read(revisionPath('kunden', 3)).author).toMatchObject({ via: 'mcp', viaClient: 'Codex' })
    })

    it('refuses a project the signed-in user is no member of', async () => {
        const db = createDb()

        await expect(
            mcpRun(db, READ_KNOWLEDGE_PAGE_TOOL, {}, mcpCall({ projectId: 'project-b' }))
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/members/) })
        await expect(
            mcpRun(db, CORRECT_KNOWLEDGE_PAGE_TOOL, {
                slug: 'kunden',
                revision: 2,
                correction: 'x',
                body: 'x',
                projectId: 'project-b',
            })
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/members/) })
        expect(db.read(pagePath('kunden')).revision).toBe(2)
    })
})

describe('search_knowledge, save_knowledge_contribution and remove_knowledge_contribution', () => {
    it('confirms a cross-project draft without a project argument, rechecking its destination access', async () => {
        const db = createDb({
            'projects/project-b': { name: 'Other', userIds: ['member'] },
            'knowledgeBases/project-b': { enabled: true },
        })
        const execute = (args, messageId = 'message-1') =>
            executeKnowledgeBaseTool({
                db,
                toolName: SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
                args,
                toolRuntimeContext: chatRun({ messageId }),
                enqueue: async () => {},
                now: NOW,
            })
        const draft = await execute({
            projectId: 'project-b',
            text: 'The meeting is on Tuesday.',
            origin: 'user_statement',
            mayContainPrivateInformation: true,
        })
        expect(draft.note).toContain('"projectId":"project-b"')
        await expect(
            execute({ draftId: draft.draftId, confirmed: true, projectId: PROJECT_ID }, 'message-2')
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/belongs to project/) })
        await expect(execute({ draftId: draft.draftId, confirmed: true }, 'message-2')).resolves.toMatchObject({
            success: true,
            projectId: 'project-b',
        })
        expect([...db.documents.keys()].filter(path => path.includes('/contributions/'))).toEqual([
            expect.stringMatching(/^knowledgeBases\/project-b\/contributions\//),
        ])

        const second = await execute({
            projectId: 'project-b',
            text: 'The launch is in May.',
            origin: 'user_statement',
            mayContainPrivateInformation: true,
        })
        db.write('projects/project-b', { userIds: [] })
        await expect(execute({ draftId: second.draftId, confirmed: true }, 'message-2')).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/members/),
        })
        db.write('projects/project-b', { userIds: ['someone-else'] })
        await expect(
            executeKnowledgeBaseTool({
                db,
                toolName: SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
                args: { draftId: second.draftId, confirmed: true },
                toolRuntimeContext: chatRun({ requestUserId: 'someone-else', messageId: 'message-2' }),
                now: NOW,
            })
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/no such draft/) })
    })

    it('restores only this member’s live pending drafts in this conversation, even with no wiki pages', async () => {
        const { loadPendingKnowledgeContributionDrafts } = require('./knowledgeContributions')
        const db = createDb({
            'projects/project-b': { name: 'Other', userIds: ['member'] },
            'knowledgeBases/project-b': { enabled: true },
        })
        const context = chatRun({ messageId: 'message-1' })
        const draft = await executeKnowledgeBaseTool({
            db,
            toolName: SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
            args: {
                projectId: 'project-b',
                text: 'Confirmed wording.',
                origin: 'assistant_summary',
                mayContainPrivateInformation: true,
            },
            toolRuntimeContext: context,
            now: NOW,
        })
        db.documents.delete(KB_PATH)
        const prompt = await getKnowledgeBaseContextMessage({
            db,
            context: { ...context, messageId: 'message-2' },
            now: NOW,
        })
        expect(prompt).toContain(draft.draftId)
        expect(prompt).toContain('Confirmed wording.')
        for (const changed of [{ objectId: 'another-chat' }, { requestUserId: 'teammate' }, { writingDraft: true }]) {
            expect(
                await getKnowledgeBaseContextMessage({ db, context: { ...context, ...changed }, now: NOW })
            ).not.toContain(draft.draftId)
        }
        expect(
            await loadPendingKnowledgeContributionDrafts({
                db,
                userId: 'member',
                context: { ...context, objectId: null },
                now: NOW,
            })
        ).toEqual([])
        expect(await getKnowledgeBaseContextMessage({ db, context, now: NOW + 3 * 60 * 60 * 1000 })).not.toContain(
            draft.draftId
        )
        db.write('projects/project-b', { userIds: [] })
        expect(await getKnowledgeBaseContextMessage({ db, context, now: NOW })).not.toContain(draft.draftId)
    })

    it('searches the pages of the chosen project, checking membership like a read', async () => {
        const db = createDb()
        const result = await run(db, SEARCH_KNOWLEDGE_TOOL, { query: 'Pilotkunde' })
        expect(result).toMatchObject({ success: true, projectId: PROJECT_ID })
        expect(result.results.map(page => page.slug)).toEqual(['kunden'])
        expect(result.results[0].passages[0].text).toBe('Acme ist Pilotkunde . Ansprechpartnerin ist Frau Berg .')

        await expect(run(db, SEARCH_KNOWLEDGE_TOOL, { query: 'Acme', projectId: 'project-b' })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/members/),
        })
    })

    it('saves only for a run answering a member directly', async () => {
        const db = createDb()
        const args = { text: 'Acme zahlt jährlich.', origin: 'user_statement', mayContainPrivateInformation: false }

        await expect(
            run(db, SAVE_KNOWLEDGE_CONTRIBUTION_TOOL, args, chatRun({ allowKnowledgeCorrections: false }))
        ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/not permitted/) })

        const saved = await executeKnowledgeBaseTool({
            db,
            toolName: SAVE_KNOWLEDGE_CONTRIBUTION_TOOL,
            args,
            assistantId: 'anna',
            toolRuntimeContext: chatRun(),
            enqueue: async () => {},
            now: NOW,
            fieldValue,
        })
        expect(saved).toMatchObject({ success: true, contributionId: expect.any(String) })

        const index = await run(db, READ_KNOWLEDGE_PAGE_TOOL, {})
        expect(index.contributions).toEqual([expect.objectContaining({ contributionId: saved.contributionId })])

        await expect(
            run(db, REMOVE_KNOWLEDGE_CONTRIBUTION_TOOL, { contributionId: saved.contributionId })
        ).resolves.toMatchObject({ success: true, alreadyRemoved: false })
    })
})
