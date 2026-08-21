/**
 * Tests for the per-user dictation vocabulary's cache and workspace scan (PT-4648).
 *
 * Two contracts matter more than the happy path:
 *
 *  1. NOTHING HERE MAY THROW INTO THE RAMBLER. Losing the personalized spelling boost is a bad day;
 *     losing the dictation is a broken feature. Every failure must degrade to the static glossary.
 *  2. THE TRANSCRIPTION PATH NEVER SCANS THE WORKSPACE. A fresh cache must cost exactly one
 *     document read — if that regresses, the ~1s dictation quietly becomes an O(projects) one.
 */

const {
    VOICE_VOCABULARY_DOC_PATH,
    VOCABULARY_TTL_MS,
    MAX_PROJECTS_SCANNED,
    MAX_CONTACTS_PER_PROJECT,
    FEED_PUBLIC_FOR_ALL,
    isFresh,
    resolveScopeProjectIds,
    readCachedVocabulary,
    buildUserVocabulary,
    rebuildAndStoreVocabulary,
    getUserVocabularyTerms,
} = require('./userVoiceVocabulary')

const NOW = 1_700_000_000_000

/**
 * A Firestore double that records every path it is asked for, so a test can assert that the fresh
 * path really did only one read. Deliberately shaped like the real chained API rather than a
 * hand-wave, because the query shape (the `isPublicFor` filter especially) is part of the contract.
 */
function createDb({ docs = {}, collections = {}, failCollections = [] } = {}) {
    const reads = []
    const writes = []

    const makeSnapshot = data => ({
        exists: data !== undefined,
        data: () => data,
    })

    return {
        reads,
        writes,
        doc(path) {
            return {
                async get() {
                    reads.push(path)
                    return makeSnapshot(docs[path])
                },
                async set(data, options) {
                    writes.push({ path, data, options })
                },
            }
        },
        collection(path) {
            const query = {
                _where: null,
                _limit: null,
                where(field, op, value) {
                    query._where = { field, op, value }
                    return query
                },
                limit(count) {
                    query._limit = count
                    return query
                },
                async get() {
                    reads.push(path)
                    if (failCollections.includes(path)) throw new Error(`boom: ${path}`)
                    const rows = collections[path] || []
                    const limited = query._limit ? rows.slice(0, query._limit) : rows
                    return { docs: limited.map(row => ({ data: () => row })), query: query._where }
                },
            }
            return query
        },
    }
}

const USER_DATA = {
    projectIds: ['p1', 'p2', 'archived-1', 'guide-1'],
    archivedProjectIds: ['archived-1'],
    guideProjectIds: ['guide-1'],
}

describe('isFresh', () => {
    test('accepts a stamp inside the TTL and rejects one outside it', () => {
        expect(isFresh(NOW - 1000, NOW)).toBe(true)
        expect(isFresh(NOW - VOCABULARY_TTL_MS - 1, NOW)).toBe(false)
    })

    test('treats a missing or malformed stamp as stale', () => {
        expect(isFresh(undefined, NOW)).toBe(false)
        expect(isFresh(0, NOW)).toBe(false)
        expect(isFresh('yesterday', NOW)).toBe(false)
    })

    test('treats a future stamp as clock skew rather than rebuilding in a loop', () => {
        // A rebuild would write the same skewed stamp again, so looping would be permanent.
        expect(isFresh(NOW + 60_000, NOW)).toBe(true)
    })
})

describe('resolveScopeProjectIds', () => {
    test('keeps active projects and drops archived, template and guide ones', () => {
        // On the reporting account this is what removes 64 guide projects, which are full of other
        // people's names and would crowd out the user's actual colleagues.
        expect(resolveScopeProjectIds(USER_DATA)).toEqual(['p1', 'p2'])
    })

    test('deduplicates and ignores malformed entries', () => {
        expect(resolveScopeProjectIds({ projectIds: ['p1', 'p1', '', '  ', null, 7, ' p2 '] })).toEqual(['p1', 'p2'])
    })

    test('tolerates a user document with no projects at all', () => {
        expect(resolveScopeProjectIds(undefined)).toEqual([])
        expect(resolveScopeProjectIds({})).toEqual([])
    })
})

describe('readCachedVocabulary', () => {
    test('returns the stored terms and stamp', async () => {
        const db = createDb({ docs: { [VOICE_VOCABULARY_DOC_PATH('u1')]: { terms: ['Somova'], updatedAt: NOW } } })
        expect(await readCachedVocabulary(db, 'u1')).toEqual({ terms: ['Somova'], updatedAt: NOW })
    })

    test('returns null when there is no document', async () => {
        expect(await readCachedVocabulary(createDb(), 'u1')).toBeNull()
    })

    test('drops malformed stored entries rather than putting them on the wire', async () => {
        const db = createDb({
            docs: { [VOICE_VOCABULARY_DOC_PATH('u1')]: { terms: ['Ok', '', null, 5, '  Padded  '], updatedAt: NOW } },
        })
        expect((await readCachedVocabulary(db, 'u1')).terms).toEqual(['Ok', 'Padded'])
    })

    test('never throws when the read fails', async () => {
        const db = {
            doc: () => ({
                get: async () => {
                    throw new Error('permission denied')
                },
            }),
        }
        expect(await readCachedVocabulary(db, 'u1')).toBeNull()
    })
})

describe('buildUserVocabulary', () => {
    const db = () =>
        createDb({
            docs: { 'projects/p1': { name: 'JTL Project Juno' }, 'projects/p2': { name: 'Alldone Product' } },
            collections: {
                'projectsContacts/p1/contacts': [
                    { displayName: 'Anna Somova', company: 'Heyflow GmbH', lastEditionDate: NOW },
                    { displayName: 'Team Lead', company: 'Test Company' },
                ],
                'projectsContacts/p2/contacts': [{ displayName: 'Michael Haizmann', company: 'Signal Iduna' }],
                'assistants/p1/items': [{ displayName: 'Alldone CTO', lastEditionDate: NOW }],
                'assistants/p2/items': [],
            },
        })

    test('collects distinctive terms across the active projects', async () => {
        const built = await buildUserVocabulary({ db: db(), userId: 'u1', userData: USER_DATA, now: NOW })
        expect(built.terms).toEqual(
            expect.arrayContaining(['Anna Somova', 'Heyflow', 'Michael Haizmann', 'Alldone CTO'])
        )
    })

    test('does not collect the generic names it saw along the way', async () => {
        const built = await buildUserVocabulary({ db: db(), userId: 'u1', userData: USER_DATA, now: NOW })
        expect(built.terms).not.toContain('Team Lead')
        expect(built.terms).not.toContain('Test Company')
    })

    test('excludes the static glossary so it cannot consume a user slot', async () => {
        const built = await buildUserVocabulary({
            db: db(),
            userId: 'u1',
            userData: USER_DATA,
            now: NOW,
            excludeTerms: ['Alldone CTO'],
        })
        expect(built.terms).not.toContain('Alldone CTO')
    })

    test('never reads a project outside the active scope', async () => {
        const database = db()
        await buildUserVocabulary({ db: database, userId: 'u1', userData: USER_DATA, now: NOW })
        expect(database.reads.some(path => path.includes('archived-1'))).toBe(false)
        expect(database.reads.some(path => path.includes('guide-1'))).toBe(false)
    })

    test('filters contacts by visibility, since the Admin SDK bypasses security rules', async () => {
        // Without this a colleague's private contact would leak into this user's keyterm list.
        const database = db()
        let capturedWhere = null
        const originalCollection = database.collection.bind(database)
        database.collection = path => {
            const query = originalCollection(path)
            if (!path.startsWith('projectsContacts/')) return query
            const originalWhere = query.where.bind(query)
            query.where = (field, op, value) => {
                capturedWhere = { field, op, value }
                return originalWhere(field, op, value)
            }
            return query
        }
        await buildUserVocabulary({ db: database, userId: 'u1', userData: USER_DATA, now: NOW })
        expect(capturedWhere).toEqual({
            field: 'isPublicFor',
            op: 'array-contains-any',
            value: [FEED_PUBLIC_FOR_ALL, 'u1'],
        })
    })

    test('reports the scan it actually performed rather than truncating silently', async () => {
        const built = await buildUserVocabulary({ db: db(), userId: 'u1', userData: USER_DATA, now: NOW })
        expect(built.stats).toMatchObject({
            scopeProjectCount: 2,
            scannedProjectCount: 2,
            skippedProjectCount: 0,
            failedProjectCount: 0,
        })
    })

    test('caps the number of projects scanned and says how many it skipped', async () => {
        const manyProjects = Array.from({ length: MAX_PROJECTS_SCANNED + 7 }, (_, i) => `p${i}`)
        const built = await buildUserVocabulary({
            db: createDb(),
            userId: 'u1',
            userData: { projectIds: manyProjects },
            now: NOW,
        })
        expect(built.stats.scannedProjectCount).toBe(MAX_PROJECTS_SCANNED)
        expect(built.stats.skippedProjectCount).toBe(7)
    })

    test('caps contacts per project', async () => {
        const contacts = Array.from({ length: MAX_CONTACTS_PER_PROJECT + 50 }, (_, i) => ({
            displayName: `Distinctname${i}`,
        }))
        const built = await buildUserVocabulary({
            db: createDb({ collections: { 'projectsContacts/p1/contacts': contacts } }),
            userId: 'u1',
            userData: { projectIds: ['p1'] },
            now: NOW,
        })
        expect(built.stats.contactCount).toBe(MAX_CONTACTS_PER_PROJECT)
    })

    test('a failing project contributes nothing instead of failing the whole build', async () => {
        const database = createDb({
            docs: { 'projects/p2': { name: 'Alldone Product' } },
            collections: { 'projectsContacts/p2/contacts': [{ displayName: 'Michael Haizmann' }] },
            failCollections: ['projectsContacts/p1/contacts'],
        })
        const built = await buildUserVocabulary({ db: database, userId: 'u1', userData: USER_DATA, now: NOW })
        expect(built.stats.failedProjectCount).toBe(1)
        expect(built.terms).toContain('Michael Haizmann')
    })

    test('returns an empty list for a user with no projects', async () => {
        const built = await buildUserVocabulary({ db: createDb(), userId: 'u1', userData: {}, now: NOW })
        expect(built.terms).toEqual([])
    })
})

describe('rebuildAndStoreVocabulary', () => {
    test('persists the terms with a stamp', async () => {
        const db = createDb({
            docs: { 'projects/p1': { name: 'Project Juno' } },
            collections: { 'projectsContacts/p1/contacts': [{ displayName: 'Anna Somova' }] },
        })
        await rebuildAndStoreVocabulary({ db, userId: 'u1', userData: { projectIds: ['p1'] }, now: NOW })
        expect(db.writes).toHaveLength(1)
        expect(db.writes[0].path).toBe(VOICE_VOCABULARY_DOC_PATH('u1'))
        expect(db.writes[0].data.updatedAt).toBe(NOW)
        expect(db.writes[0].data.terms).toContain('Anna Somova')
    })

    test('still returns usable terms when the write fails', async () => {
        // A vocabulary we could not store is perfectly usable for the dictation in flight.
        const db = createDb({ collections: { 'projectsContacts/p1/contacts': [{ displayName: 'Anna Somova' }] } })
        db.doc = () => ({
            get: async () => ({ exists: false, data: () => undefined }),
            set: async () => {
                throw new Error('write failed')
            },
        })
        const built = await rebuildAndStoreVocabulary({ db, userId: 'u1', userData: { projectIds: ['p1'] }, now: NOW })
        expect(built.terms).toContain('Anna Somova')
    })
})

describe('getUserVocabularyTerms', () => {
    test('a fresh cache costs exactly one document read and no scan', async () => {
        // This is the steady-state path. If it ever starts touching contacts, the ~1s dictation
        // silently becomes O(projects).
        const db = createDb({
            docs: { [VOICE_VOCABULARY_DOC_PATH('u1')]: { terms: ['Somova'], updatedAt: NOW - 1000 } },
        })
        const result = await getUserVocabularyTerms({ db, userId: 'u1', userData: USER_DATA, now: NOW })
        expect(result).toEqual({ terms: ['Somova'], cacheState: 'fresh', pendingRebuild: null })
        expect(db.reads).toEqual([VOICE_VOCABULARY_DOC_PATH('u1')])
    })

    test('a stale cache is served immediately and refreshed in the background', async () => {
        const db = createDb({
            docs: {
                [VOICE_VOCABULARY_DOC_PATH('u1')]: { terms: ['Stale Term'], updatedAt: NOW - VOCABULARY_TTL_MS - 1 },
                'projects/p1': { name: 'Project Juno' },
            },
            collections: { 'projectsContacts/p1/contacts': [{ displayName: 'Anna Somova' }] },
        })
        const result = await getUserVocabularyTerms({ db, userId: 'u1', userData: USER_DATA, now: NOW })

        // The user's audio is not delayed for a day-old contact list.
        expect(result.terms).toEqual(['Stale Term'])
        expect(result.cacheState).toBe('stale')
        expect(result.pendingRebuild).not.toBeNull()

        await result.pendingRebuild
        expect(db.writes[0].data.terms).toContain('Anna Somova')
    })

    test('a cold miss builds inline so the first dictation already benefits', async () => {
        const db = createDb({
            docs: { 'projects/p1': { name: 'Project Juno' } },
            collections: { 'projectsContacts/p1/contacts': [{ displayName: 'Anna Somova' }] },
        })
        const result = await getUserVocabularyTerms({ db, userId: 'u1', userData: { projectIds: ['p1'] }, now: NOW })
        expect(result.cacheState).toBe('cold')
        expect(result.terms).toContain('Anna Somova')
    })

    test('degrades to the static glossary when the whole lookup fails', async () => {
        const db = {
            doc: () => {
                throw new Error('firestore is down')
            },
        }
        const result = await getUserVocabularyTerms({ db, userId: 'u1', userData: USER_DATA, now: NOW })
        expect(result.terms).toEqual([])
        // Reported as an outage, NOT as a cold build that found an empty workspace — those are the
        // two states the log line exists to tell apart.
        expect(result.cacheState).toBe('unavailable')
    })

    test('a genuinely empty workspace still reports a successful cold build', async () => {
        const result = await getUserVocabularyTerms({
            db: createDb(),
            userId: 'u1',
            userData: { projectIds: ['p1'] },
            now: NOW,
        })
        expect(result.terms).toEqual([])
        expect(result.cacheState).toBe('cold')
    })

    test('degrades when called without a database or user', async () => {
        expect(await getUserVocabularyTerms({ db: null, userId: 'u1' })).toEqual({
            terms: [],
            cacheState: 'unavailable',
            pendingRebuild: null,
        })
        expect(await getUserVocabularyTerms({ db: createDb(), userId: '' })).toEqual({
            terms: [],
            cacheState: 'unavailable',
            pendingRebuild: null,
        })
    })

    test('never rejects, whatever the workspace does', async () => {
        const db = createDb({
            failCollections: ['projectsContacts/p1/contacts', 'assistants/p1/items'],
        })
        await expect(
            getUserVocabularyTerms({ db, userId: 'u1', userData: { projectIds: ['p1'] }, now: NOW })
        ).resolves.toBeDefined()
    })
})
