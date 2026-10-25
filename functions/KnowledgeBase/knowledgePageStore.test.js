const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const { KNOWLEDGE_BASE_MAX_PAGES, KNOWLEDGE_PAGE_MAX_CHARS } = require('./knowledgeBaseModel')
const {
    archiveKnowledgePage,
    buildKnowledgeIndex,
    loadKnowledgePages,
    writeKnowledgePage,
} = require('./knowledgePageStore')

const PROJECT_ID = 'project-a'
const NOW = 1_800_000_000_000
const pagePath = slug => `knowledgeBases/${PROJECT_ID}/pages/${slug}`
const revisionPath = (slug, revision) => `${pagePath(slug)}/revisions/${String(revision).padStart(6, '0')}`

function write(db, args) {
    return writeKnowledgePage({ db, projectId: PROJECT_ID, now: NOW, fieldValue, runId: 'run-1', ...args })
}

describe('writeKnowledgePage', () => {
    it('creates a page with its first revision and records what it cites and links', async () => {
        const db = new KnowledgeFirestoreDouble({})

        const result = await write(db, {
            title: 'Kunden & Partner',
            summary: 'Wer mit dem Projekt zusammenarbeitet.',
            body: '## Acme\nAcme ist Pilotkunde [[task:t1]], siehe [[entscheidungen]].',
            sourceKeys: ['task:t1', 'note:n1'],
            allowedSourceKeys: new Set(['task:t1', 'note:n1']),
            expectedRevision: 0,
            reason: 'Neuer Kunde',
        })

        expect(result).toMatchObject({ success: true, slug: 'kunden-partner', revision: 1, created: true })
        expect(db.read(pagePath('kunden-partner'))).toMatchObject({
            title: 'Kunden & Partner',
            revision: 1,
            sourceKeys: ['task:t1', 'note:n1'],
            links: ['entscheidungen'],
            archived: false,
            needsRebuild: false,
            createdAt: NOW,
            lastRunId: 'run-1',
        })
        expect(db.read(revisionPath('kunden-partner', 1))).toMatchObject({
            revision: 1,
            reason: 'Neuer Kunde',
            runId: 'run-1',
            created: true,
        })

        // The Updates feed tells a new page from a changed one by this flag.
        await write(db, {
            slug: 'kunden-partner',
            title: 'Kunden & Partner',
            summary: 'Wer mit dem Projekt zusammenarbeitet.',
            body: '## Acme\nAcme ist Kunde [[task:t1]].',
            allowedSourceKeys: new Set(['task:t1']),
            expectedRevision: 1,
        })
        expect(db.read(revisionPath('kunden-partner', 2)).created).toBe(false)
    })

    it('removes citations of sources the run may not cite, invented ones included', async () => {
        const db = new KnowledgeFirestoreDouble({})

        const result = await write(db, {
            title: 'Überblick',
            summary: 'Worum es geht.',
            body: 'Start im März [[task:t1]]. Budget vertraulich [[task:private|laut Plan]]. Erfunden [[note:made-up]].',
            sourceKeys: ['task:t1', 'task:private'],
            allowedSourceKeys: new Set(['task:t1']),
            expectedRevision: 0,
        })

        expect(result.removedSourceReferences).toEqual(['task:private', 'note:made-up'])
        const page = db.read(pagePath('uberblick'))
        expect(page.body).toBe('Start im März [[task:t1]]. Budget vertraulich laut Plan. Erfunden .')
        expect(page.sourceKeys).toEqual(['task:t1'])
    })

    it('only replaces a page that was read at its current revision', async () => {
        const db = new KnowledgeFirestoreDouble({
            [pagePath('glossar')]: { slug: 'glossar', title: 'Glossar', body: 'alt', revision: 3, sourceKeys: [] },
        })
        const args = { title: 'Glossar', summary: 's', body: 'neu', allowedSourceKeys: new Set() }

        await expect(write(db, { ...args, expectedRevision: null })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/Read it with read_page/),
        })
        await expect(write(db, { ...args, expectedRevision: 2 })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/changed since it was read/),
        })
        await expect(write(db, { ...args, expectedRevision: 3 })).resolves.toMatchObject({ success: true, revision: 4 })
    })

    it('keeps the sources a page already relied on when an ingest extends it', async () => {
        const db = new KnowledgeFirestoreDouble({
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                body: 'Acme [[task:t1]]',
                revision: 1,
                sourceKeys: ['task:t1'],
            },
        })

        await write(db, {
            slug: 'kunden',
            title: 'Kunden',
            summary: 's',
            body: 'Acme [[task:t1]]. Beta [[task:t2]].',
            sourceKeys: ['task:t2'],
            allowedSourceKeys: new Set(['task:t2']),
            expectedRevision: 1,
        })

        expect(db.read(pagePath('kunden')).sourceKeys).toEqual(['task:t1', 'task:t2'])
    })

    // A withdrawn source has to be found in old revisions too, even once the page stopped citing it.
    it('remembers every source any revision cited', async () => {
        const db = new KnowledgeFirestoreDouble({
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                body: 'Acme [[task:t1]]',
                revision: 1,
                sourceKeys: ['task:t1'],
                historicalSourceKeys: ['task:t1', 'note:old'],
            },
        })

        const result = await write(db, {
            slug: 'kunden',
            title: 'Kunden',
            summary: 's',
            body: 'Acme [[task:t1]]. Beta [[task:t2]].',
            sourceKeys: ['task:t2'],
            allowedSourceKeys: new Set(['task:t2']),
            expectedRevision: 1,
        })

        expect(db.read(pagePath('kunden')).historicalSourceKeys).toEqual(['task:t1', 'note:old', 'task:t2'])
        // The returned copy is what the ingest keeps in memory; a sentinel has no business there.
        expect(result.page.historicalSourceKeys).toBeUndefined()
    })

    it('leaves a page waiting for a rebuild alone, except for the rebuild itself', async () => {
        const db = new KnowledgeFirestoreDouble({
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                body: 'Acme [[task:t1]], geheim [[note:n1]]',
                revision: 2,
                sourceKeys: ['task:t1'],
                removedSourceKeys: ['note:n1'],
                needsRebuild: true,
                needsRebuildReason: 'privacy',
                needsRebuildSince: NOW - 1,
            },
        })
        const args = { slug: 'kunden', title: 'Kunden', summary: 's', body: 'Acme [[task:t1]]', expectedRevision: 2 }

        await expect(write(db, { ...args, allowedSourceKeys: new Set(['task:t1']) })).resolves.toMatchObject({
            success: false,
            error: expect.stringMatching(/being rebuilt/),
        })

        const rebuilt = await write(db, { ...args, mode: 'rebuild', allowedSourceKeys: new Set(['task:t1']) })

        expect(rebuilt).toMatchObject({ success: true, revision: 3 })
        const page = db.read(pagePath('kunden'))
        expect(page).toMatchObject({ needsRebuild: false, sourceKeys: ['task:t1'] })
        expect(page).not.toHaveProperty('removedSourceKeys')
        expect(page).not.toHaveProperty('needsRebuildReason')
        expect(page).not.toHaveProperty('needsRebuildSince')
    })

    it('labels the sources the page keeps and drops labels of sources it lost', async () => {
        const db = new KnowledgeFirestoreDouble({
            [pagePath('kunden')]: {
                slug: 'kunden',
                title: 'Kunden',
                body: 'Acme [[task:t1]]',
                revision: 1,
                sourceKeys: ['task:t1'],
                sourceLabels: { 'task:t1': 'Acme Pilot', 'task:gone': 'Alt' },
            },
        })

        await write(db, {
            slug: 'kunden',
            title: 'Kunden',
            summary: 's',
            body: 'Acme [[task:t1]], Beta [[task:t2]]',
            allowedSourceKeys: new Set(['task:t2']),
            sourceLabels: { 'task:t2': 'Beta gewinnen', 'task:unused': 'Nicht zitiert' },
            expectedRevision: 1,
        })

        expect(db.read(pagePath('kunden')).sourceLabels).toEqual({
            'task:t1': 'Acme Pilot',
            'task:t2': 'Beta gewinnen',
        })
    })

    it('refuses a body over the limit instead of truncating it', async () => {
        const result = await write(new KnowledgeFirestoreDouble({}), {
            title: 'Groß',
            summary: 's',
            body: 'x'.repeat(KNOWLEDGE_PAGE_MAX_CHARS + 1),
            allowedSourceKeys: new Set(),
            expectedRevision: 0,
        })
        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Split it/) })
    })

    it('refuses a new page once the wiki is full', async () => {
        const result = await write(new KnowledgeFirestoreDouble({}), {
            title: 'Noch eine',
            summary: 's',
            body: 'b',
            allowedSourceKeys: new Set(),
            expectedRevision: 0,
            activePageCount: KNOWLEDGE_BASE_MAX_PAGES,
        })
        expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Extend an existing page/) })
    })

    it('clips an over-long title and summary rather than failing the write', async () => {
        const db = new KnowledgeFirestoreDouble({})
        await write(db, {
            slug: 'lang',
            title: 'T'.repeat(300),
            summary: 'S'.repeat(500),
            body: 'b',
            allowedSourceKeys: new Set(),
            expectedRevision: 0,
        })
        const page = db.read(pagePath('lang'))
        expect(page.title.length).toBeLessThanOrEqual(120)
        expect(page.summary.length).toBeLessThanOrEqual(200)
    })
})

describe('archiveKnowledgePage', () => {
    it('needs the current revision in an ingest and records a revision', async () => {
        const db = new KnowledgeFirestoreDouble({ [pagePath('alt')]: { slug: 'alt', title: 'Alt', revision: 4 } })
        const archive = expectedRevision =>
            archiveKnowledgePage({ db, projectId: PROJECT_ID, slug: 'alt', expectedRevision, now: NOW, fieldValue })

        await expect(archive(null)).resolves.toMatchObject({ success: false })
        await expect(archive(4)).resolves.toMatchObject({ success: true, revision: 5 })
        expect(db.read(pagePath('alt'))).toMatchObject({ archived: true, revision: 5 })
        expect(db.read(revisionPath('alt', 5))).toMatchObject({ archived: true })
    })

    it('takes the text off the page document and leaves it to the earlier revisions', async () => {
        const db = new KnowledgeFirestoreDouble({
            [pagePath('alt')]: { slug: 'alt', title: 'Alt', summary: 'Old', body: 'Old text', revision: 1 },
            [revisionPath('alt', 1)]: { revision: 1, title: 'Alt', summary: 'Old', body: 'Old text' },
        })

        await archiveKnowledgePage({
            db,
            projectId: PROJECT_ID,
            slug: 'alt',
            expectedRevision: 1,
            now: NOW,
            fieldValue,
        })

        const page = db.read(pagePath('alt'))
        expect(page).toMatchObject({ archived: true, title: 'Alt' })
        expect(page).not.toHaveProperty('body')
        expect(page).not.toHaveProperty('summary')
        expect(db.read(revisionPath('alt', 1)).body).toBe('Old text')
    })
})

describe('buildKnowledgeIndex', () => {
    it('lists visible pages alphabetically and leaves out pages being rebuilt', async () => {
        const db = new KnowledgeFirestoreDouble({
            [pagePath('kunden')]: { title: 'Kunden', summary: 'Wer zahlt.' },
            [pagePath('alt')]: { title: 'Alt', archived: true },
            [pagePath('geheim')]: { title: 'Geheim', summary: 'stammt aus einer privaten Notiz', needsRebuild: true },
            [pagePath('abläufe')]: { title: 'Abläufe' },
        })

        const index = buildKnowledgeIndex(await loadKnowledgePages(db, PROJECT_ID))

        expect(index).toBe('- [[abläufe]] Abläufe\n- [[kunden]] Kunden — Wer zahlt.')
    })

    it('caps the index and says how many pages it left out', () => {
        const pages = new Map()
        for (let index = 0; index < 50; index++)
            pages.set(`p${index}`, { slug: `p${index}`, title: `Seite ${index}`, summary: 'x'.repeat(100) })
        const index = buildKnowledgeIndex(pages, { maxChars: 1000 })
        expect(index.length).toBeLessThan(1100)
        expect(index).toMatch(/… and \d+ more pages$/)
    })
})
