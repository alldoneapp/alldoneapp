const { KnowledgeFirestoreDouble } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    WIKI_SEARCH_COLLECTION,
    buildKnowledgePageSearchRecord,
    buildProjectKnowledgeSearchRecords,
    findPassages,
    onKnowledgePageWritten,
    parseSearchQuery,
    scoreKnowledgePage,
    searchKnowledgeBase,
    toPlainWikiText,
} = require('./knowledgeSearch')

const PROJECT_ID = 'project-a'
const pagePath = (slug, projectId = PROJECT_ID) => `knowledgeBases/${projectId}/pages/${slug}`

const PRICING_BODY = [
    '# Pricing',
    '',
    'Credits are sold in packages [[task:t1]]. The package price stays unchanged [[correction:k1|by decision]].',
    '',
    '## Open questions',
    '',
    '- How many credits a package holds is still open [[note:n1]].',
    '',
    'Unrelated paragraph about the release train and [[onboarding|Onboarding]].',
].join('\n')

function createDb(extra = {}) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { name: 'Alldone Product', userIds: ['member'] },
        ['projects/project-b']: { name: 'Juno', userIds: ['member'] },
        ['projects/project-c']: { name: 'Foreign', userIds: ['someone-else'] },
        [`knowledgeBases/${PROJECT_ID}`]: { enabled: true },
        ['knowledgeBases/project-b']: { enabled: true },
        ['knowledgeBases/project-c']: { enabled: true },
        [pagePath('pricing')]: {
            title: 'Preise und Credits',
            summary: 'How Alldone is priced.',
            body: PRICING_BODY,
            revision: 3,
            updatedAt: 1_800_000_000_000,
            archived: false,
            needsRebuild: false,
        },
        [pagePath('onboarding')]: {
            title: 'Onboarding',
            summary: 'First steps for new users.',
            body: 'New users get 100 free credits [[task:t2]].',
            revision: 1,
            archived: false,
            needsRebuild: false,
        },
        // Hidden: a source of it was withdrawn a moment ago. Its text still says "credits".
        [pagePath('geheim')]: {
            title: 'Credits secret',
            body: 'Secret credit deal [[task:private]].',
            archived: false,
            needsRebuild: true,
        },
        [pagePath('alt')]: { title: 'Old credits', archived: true },
        [pagePath('juno', 'project-b')]: {
            title: 'Juno credits',
            summary: 'Juno pricing.',
            body: 'Juno sells credits per seat.',
            archived: false,
            needsRebuild: false,
        },
        [pagePath('foreign', 'project-c')]: {
            title: 'Credits elsewhere',
            body: 'Credits credits credits.',
            archived: false,
            needsRebuild: false,
        },
        ...extra,
    })
}

describe('query parsing and scoring', () => {
    it('folds accents and case and drops words that say nothing', () => {
        expect(parseSearchQuery('Wie funktionieren die PREISE für Übersicht?').terms).toEqual([
            'funktionieren',
            'preise',
            'ubersicht',
        ])
        expect(parseSearchQuery('   ').terms).toEqual([])
    })

    it('matches word beginnings, ranks a title hit first and needs most of a long query', () => {
        const page = { slug: 'pricing', title: 'Preise und Credits', summary: '', body: PRICING_BODY }
        expect(scoreKnowledgePage(page, parseSearchQuery('credit'))).not.toBeNull()
        // "redits" is inside a word, not at its start.
        expect(scoreKnowledgePage(page, parseSearchQuery('redits'))).toBeNull()
        const titleHit = scoreKnowledgePage(page, parseSearchQuery('preise'))
        const bodyHit = scoreKnowledgePage(page, parseSearchQuery('release'))
        expect(titleHit.score).toBeGreaterThan(bodyHit.score)
        expect(scoreKnowledgePage(page, parseSearchQuery('credits zebra giraffe walrus'))).toBeNull()
        expect(scoreKnowledgePage(page, parseSearchQuery('credits package open zebra'))).not.toBeNull()
    })

    it('quotes passages as readers see them, under their heading, without citation tokens', () => {
        const passages = findPassages({ body: PRICING_BODY }, parseSearchQuery('credits package'))
        expect(passages[0]).toEqual({
            heading: 'Pricing',
            text: 'Credits are sold in packages . The package price stays unchanged by decision.',
        })
        expect(passages[1]).toEqual({
            heading: 'Open questions',
            text: 'How many credits a package holds is still open .',
        })
        expect(JSON.stringify(passages)).not.toContain('[[')
        expect(toPlainWikiText('See [[onboarding]] and [[task:t1|the task]] [[note:n1]].')).toBe(
            'See onboarding and the task .'
        )
    })

    it('cuts a long paragraph around the match', () => {
        const long = `${'filler '.repeat(120)}the decisive credits sentence ${'tail '.repeat(120)}`
        const [passage] = findPassages({ body: long }, parseSearchQuery('decisive'))
        expect(passage.text.length).toBeLessThan(380)
        expect(passage.text).toContain('decisive credits sentence')
        expect(passage.text.startsWith('…')).toBe(true)
        expect(passage.text.endsWith('…')).toBe(true)
    })
})

describe('searchKnowledgeBase', () => {
    it('finds pages of one project with passages and never returns a hidden or archived page', async () => {
        const db = createDb()
        const result = await searchKnowledgeBase({ db, userId: 'member', projectId: PROJECT_ID, query: 'credits' })

        expect(result).toMatchObject({ success: true, scope: 'project', projectId: PROJECT_ID })
        expect(result.results.map(page => page.slug)).toEqual(['pricing', 'onboarding'])
        expect(result.results[0]).toMatchObject({
            projectId: PROJECT_ID,
            title: 'Preise und Credits',
            summary: 'How Alldone is priced.',
            revision: 3,
            updatedAt: new Date(1_800_000_000_000).toISOString(),
        })
        expect(result.results[0].passages.length).toBeGreaterThan(0)
        expect(JSON.stringify(result)).not.toContain('Secret credit deal')
        expect(JSON.stringify(result)).not.toContain('Old credits')
    })

    it('reads the pages fresh, so a page hidden a moment ago is not found', async () => {
        const db = createDb()
        db.write(pagePath('onboarding'), { needsRebuild: true }, { merge: true })
        const result = await searchKnowledgeBase({ db, userId: 'member', projectId: PROJECT_ID, query: 'credits' })
        expect(result.results.map(page => page.slug)).toEqual(['pricing'])
    })

    it('says so when nothing matches, and refuses an empty query', async () => {
        const db = createDb()
        await expect(
            searchKnowledgeBase({ db, userId: 'member', projectId: PROJECT_ID, query: 'zebra' })
        ).resolves.toMatchObject({ success: true, results: [], note: expect.stringMatching(/original tasks/) })
        await expect(
            searchKnowledgeBase({ db, userId: 'member', projectId: PROJECT_ID, query: '  ' })
        ).resolves.toMatchObject({ success: false })
    })

    it("searches all of the member's projects through the index, but returns what Firestore says", async () => {
        const db = createDb()
        const typesense = {
            isTypesenseConfigured: () => true,
            formatTypesenseFilterValue: value => `\`${value}\``,
            searchTypesenseDocuments: jest.fn(async () => ({
                // The index is a hint only: a hit for a page hidden since is dropped on the re-read.
                hits: [
                    { projectId: 'project-b', slug: 'juno' },
                    { projectId: PROJECT_ID, slug: 'geheim' },
                ],
            })),
        }
        const result = await searchKnowledgeBase({
            db,
            userId: 'member',
            projectId: PROJECT_ID,
            query: 'credits',
            allProjects: true,
            loadTypesense: () => typesense,
        })

        expect(typesense.searchTypesenseDocuments).toHaveBeenCalledWith(WIKI_SEARCH_COLLECTION, 'credits', {
            filterBy: 'projectId:=[`project-a`,`project-b`]',
            perPage: 50,
        })
        expect(result.scope).toBe('all_projects')
        expect(result.results.map(page => `${page.projectId}/${page.slug}`).sort()).toEqual([
            'project-a/onboarding',
            'project-a/pricing',
            'project-b/juno',
        ])
        expect(result.results.find(page => page.slug === 'juno').projectName).toBe('Juno')
        expect(JSON.stringify(result)).not.toContain('Credits elsewhere')
    })

    it('scans the wikis of the member directly when the index is not available', async () => {
        const db = createDb()
        const result = await searchKnowledgeBase({
            db,
            userId: 'member',
            projectId: PROJECT_ID,
            query: 'credits',
            allProjects: true,
            loadTypesense: () => ({ isTypesenseConfigured: () => false }),
        })
        expect(result.results.map(page => page.slug).sort()).toEqual(['juno', 'onboarding', 'pricing'])
    })
})

describe('the global search index', () => {
    const typesenseDouble = () => ({
        isTypesenseConfigured: () => true,
        upsertTypesenseDocument: jest.fn(async () => {}),
        deleteTypesenseDocument: jest.fn(async () => {}),
    })

    it('stores a page for the whole project, with its text for matching only', () => {
        const record = buildKnowledgePageSearchRecord({
            projectId: PROJECT_ID,
            slug: 'pricing',
            page: {
                title: 'Preise',
                summary: 'S',
                body: 'Credits [[task:t1]] and [[onboarding|Onboarding]].',
                revision: 3,
                updatedAt: 5,
            },
        })
        expect(record).toEqual({
            objectID: `pricing${PROJECT_ID}`,
            projectId: PROJECT_ID,
            slug: 'pricing',
            title: 'Preise',
            summary: 'S',
            content: 'Credits and Onboarding.',
            isPublicFor: ['0'],
            revision: 3,
            lastEditionDate: 5,
            created: undefined,
        })
    })

    it('indexes a visible page and removes it as soon as it is hidden, archived or deleted', async () => {
        const typesense = typesenseDouble()
        const visible = { title: 'Preise', body: 'x', archived: false, needsRebuild: false, revision: 1 }
        await expect(
            onKnowledgePageWritten({ projectId: PROJECT_ID, slug: 'pricing', before: null, after: visible, typesense })
        ).resolves.toEqual({ action: 'indexed' })
        expect(typesense.upsertTypesenseDocument).toHaveBeenCalledWith(
            'dev_wiki',
            expect.objectContaining({ objectID: `pricing${PROJECT_ID}` })
        )

        // A change nobody searches for (the provenance arrays) does not re-index.
        await expect(
            onKnowledgePageWritten({
                projectId: PROJECT_ID,
                slug: 'pricing',
                before: visible,
                after: { ...visible, historicalSourceKeys: ['task:t1'] },
                typesense,
            })
        ).resolves.toEqual({ action: 'unchanged' })

        for (const after of [{ ...visible, needsRebuild: true }, { ...visible, archived: true }, null]) {
            typesense.deleteTypesenseDocument.mockClear()
            await expect(
                onKnowledgePageWritten({ projectId: PROJECT_ID, slug: 'pricing', before: visible, after, typesense })
            ).resolves.toEqual({ action: 'removed' })
            expect(typesense.deleteTypesenseDocument).toHaveBeenCalledWith('dev_wiki', `pricing${PROJECT_ID}`)
        }
    })

    it('backfills only the pages that may be shown', async () => {
        const records = await buildProjectKnowledgeSearchRecords({ projectId: PROJECT_ID, db: createDb() })
        expect(records.map(record => record.slug).sort()).toEqual(['onboarding', 'pricing'])
    })
})
