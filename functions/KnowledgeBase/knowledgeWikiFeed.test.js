const { KnowledgeFirestoreDouble, fieldValue } = require('./__fixtures__/knowledgeFirestoreDouble')
const { archiveKnowledgePage, restoreKnowledgePageRevision, writeKnowledgePage } = require('./knowledgePageStore')
const {
    buildWikiRevisionFeed,
    onKnowledgePageRevisionCreated,
    publishWikiRevisionFeed,
} = require('./knowledgeWikiFeed')
const {
    FEED_WIKI_PAGE_CHANGED,
    WIKI_FEED_AUTHOR_ID,
    buildWikiFeedId,
    getWikiFeedTarget,
} = require('./knowledgeWikiFeedModel')

const PROJECT_ID = 'project-a'
// 2026-10-24 23:30 UTC: already the 25th in Berlin, still the 24th where the function runs.
const NOW = Date.UTC(2026, 9, 24, 23, 30)
const OWNER = 'owner-1'
const MEMBER = 'member-2'
const OTHER = 'member-3'
const revisionPath = (slug, revision) =>
    `knowledgeBases/${PROJECT_ID}/pages/${slug}/revisions/${String(revision).padStart(6, '0')}`

// Text that must never leave the wiki tree: when a source is withdrawn the wiki removes it from the
// page and its revisions, and nothing would remove it from a feed entry.
const PAGE_TEXT = ['Kunden und Partner', 'Wer mit dem Projekt arbeitet', 'Acme ist Pilotkunde', 'Neuer Kunde']

function createDb(extra = {}) {
    return new KnowledgeFirestoreDouble({
        [`projects/${PROJECT_ID}`]: { userIds: [OWNER, MEMBER, OTHER, 'ws@workstream-1'] },
        [`knowledgeBases/${PROJECT_ID}`]: { enabled: true, ownerUserId: OWNER },
        [`items/${PROJECT_ID}/tasks/t1`]: { isPublicFor: [0] },
        ...extra,
    })
}

async function createPage(db) {
    await writeKnowledgePage({
        db,
        projectId: PROJECT_ID,
        title: 'Kunden und Partner',
        summary: 'Wer mit dem Projekt arbeitet.',
        body: '## Acme\nAcme ist Pilotkunde [[task:t1]].',
        sourceKeys: ['task:t1'],
        allowedSourceKeys: new Set(['task:t1']),
        expectedRevision: 0,
        reason: 'Neuer Kunde',
        runId: 'run-1',
        now: NOW,
        fieldValue,
    })
    return db.read(revisionPath('kunden-und-partner', 1))
}

async function correctPage(db, expectedRevision = 1) {
    await writeKnowledgePage({
        db,
        projectId: PROJECT_ID,
        slug: 'kunden-und-partner',
        title: 'Kunden und Partner',
        summary: 'Wer mit dem Projekt arbeitet.',
        body: '## Acme\nAcme ist Kunde seit März [[correction:c1]].',
        sourceKeys: ['correction:c1'],
        allowedSourceKeys: new Set(['correction:c1']),
        expectedRevision,
        mode: 'correction',
        author: { type: 'user', userId: MEMBER, name: 'Maria Muster', correctionId: 'c1' },
        reason: 'Acme ist seit März Kunde',
        now: NOW + 1000,
        fieldValue,
    })
    return db.read(revisionPath('kunden-und-partner', expectedRevision + 1))
}

const feedPaths = db =>
    [...db.documents.keys()].filter(path => !path.startsWith('knowledgeBases/') && !path.startsWith('items/'))

describe('a wiki revision in the Updates feed', () => {
    it('lists an ingest change for the project and follows it for the owner', async () => {
        const db = createDb()
        const revision = await createPage(db)

        const result = await publishWikiRevisionFeed({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            revision,
        })

        const feedId = buildWikiFeedId('kunden-und-partner', 1)
        expect(result).toMatchObject({ published: true, feedId, followerIds: [OWNER] })
        expect(db.read(`feedsStore/${PROJECT_ID}/all/${feedId}`)).toEqual({
            type: FEED_WIKI_PAGE_CHANGED,
            lastChangeDate: NOW,
            creatorId: WIKI_FEED_AUTHOR_ID,
            objectId: 'wiki',
            isPublicFor: [0],
            entryText: 'created a wiki page',
            wikiSlug: 'kunden-und-partner',
            wikiRevision: 1,
            wikiChange: 'created',
        })
        expect(db.read(`feedsStore/${PROJECT_ID}/${OWNER}/feeds/followed/${feedId}`)).toBeDefined()
        // Filed under the day the function runs in, which is the day the client falls back to.
        expect(db.read(`projectsFeeds/${PROJECT_ID}/24102026/wiki`)).toMatchObject({
            type: 'wiki',
            isPublicFor: [0],
            lastChangeDate: NOW,
        })
        expect(db.read(`feedsObjectsLastStates/${PROJECT_ID}/wiki/wiki`)).toMatchObject({ type: 'wiki' })
    })

    it("labels a correction a member's MCP client made, and badges that member too", async () => {
        const db = createDb()
        await createPage(db)
        await writeKnowledgePage({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            title: 'Kunden und Partner',
            summary: 'Wer mit dem Projekt arbeitet.',
            body: '## Acme\nAcme ist Kunde seit März [[correction:c1]].',
            sourceKeys: ['correction:c1'],
            allowedSourceKeys: new Set(['correction:c1']),
            expectedRevision: 1,
            mode: 'correction',
            author: {
                type: 'user',
                userId: MEMBER,
                name: 'Maria Muster',
                correctionId: 'c1',
                via: 'mcp',
                viaClient: 'Claude',
            },
            reason: 'Acme ist seit März Kunde',
            now: NOW + 1000,
            fieldValue,
        })

        const result = await publishWikiRevisionFeed({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            revision: db.read(revisionPath('kunden-und-partner', 2)),
        })

        const feedId = buildWikiFeedId('kunden-und-partner', 2)
        expect(result.notifiedIds.sort()).toEqual([MEMBER, OTHER, OWNER].sort())
        expect(db.read(`feedsStore/${PROJECT_ID}/all/${feedId}`)).toMatchObject({
            creatorId: MEMBER,
            via: 'mcp',
            viaClient: 'Claude',
        })
        expect(db.read(`feedsCount/${PROJECT_ID}/${MEMBER}/followed`).wiki.wiki[feedId]).toBeDefined()
    })

    it('badges every other member for a correction a member made, and follows it for them', async () => {
        const db = createDb()
        await createPage(db)
        const revision = await correctPage(db)

        const result = await publishWikiRevisionFeed({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            revision,
        })

        const feedId = buildWikiFeedId('kunden-und-partner', 2)
        expect(result.followerIds.sort()).toEqual([MEMBER, OWNER].sort())
        expect(result.notifiedIds.sort()).toEqual([OTHER, OWNER].sort())
        expect(db.read(`feedsStore/${PROJECT_ID}/all/${feedId}`)).toMatchObject({
            creatorId: MEMBER,
            wikiChange: 'corrected',
            entryText: 'corrected a wiki page',
        })
        // The owner follows the wiki, so their badge is in Followed; the other member's is in All.
        const ownerCounter = db.read(`feedsCount/${PROJECT_ID}/${OWNER}/followed`)
        expect(ownerCounter.wiki.wiki[feedId]).toMatchObject({ dateFormated: '24102026' })
        expect(db.read(`feedsCount/${PROJECT_ID}/${OTHER}/all`).wiki.wiki[feedId].feed.wikiRevision).toBe(2)
        // Never the author's own change, and never a workstream.
        expect(feedPaths(db).some(path => path.startsWith(`feedsCount/${PROJECT_ID}/${MEMBER}/`))).toBe(false)
        expect(feedPaths(db).some(path => path.includes('ws@'))).toBe(false)
    })

    it('copies no page text into any feed document, the counters included', async () => {
        const db = createDb()
        await createPage(db)
        const revision = await correctPage(db)
        await publishWikiRevisionFeed({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            revision: db.read(revisionPath('kunden-und-partner', 1)),
        })
        await publishWikiRevisionFeed({ db, projectId: PROJECT_ID, slug: 'kunden-und-partner', revision })

        const written = JSON.stringify(feedPaths(db).map(path => db.read(path)))
        PAGE_TEXT.forEach(text => expect(written).not.toContain(text))
        expect(written).not.toContain('Kunde seit März')
        expect(written).not.toContain('Maria Muster')
    })

    it('says what kind of change it was for an archive, a rebuild and an undo', async () => {
        const db = createDb()
        await createPage(db)
        await correctPage(db)
        await restoreKnowledgePageRevision({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            expectedRevision: 2,
            targetRevision: 1,
            author: { type: 'user', userId: OTHER, name: 'Otto', undoneCorrectionId: 'c1' },
            now: NOW + 2000,
            fieldValue,
        })
        await writeKnowledgePage({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            title: 'Kunden und Partner',
            summary: 'Neu aufgebaut.',
            body: 'Acme.',
            expectedRevision: 3,
            mode: 'rebuild',
            now: NOW + 3000,
            fieldValue,
        })
        await archiveKnowledgePage({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            expectedRevision: 4,
            now: NOW + 4000,
            fieldValue,
        })

        const kinds = [3, 4, 5].map(number => {
            const built = buildWikiRevisionFeed({
                slug: 'kunden-und-partner',
                revision: db.read(revisionPath('kunden-und-partner', number)),
            })
            return [built.feed.wikiChange, built.feed.creatorId]
        })
        expect(kinds).toEqual([
            ['restored', OTHER],
            ['rebuilt', WIKI_FEED_AUTHOR_ID],
            ['archived', WIKI_FEED_AUTHOR_ID],
        ])
    })

    it('writes the same documents again when the trigger is delivered twice', async () => {
        const db = createDb()
        const revision = await createPage(db)

        await publishWikiRevisionFeed({ db, projectId: PROJECT_ID, slug: 'kunden-und-partner', revision })
        const once = feedPaths(db).sort()
        await publishWikiRevisionFeed({ db, projectId: PROJECT_ID, slug: 'kunden-und-partner', revision })

        expect(feedPaths(db).sort()).toEqual(once)
    })

    it('follows it for nobody who is no longer a member, the owner included', async () => {
        const db = createDb({ [`knowledgeBases/${PROJECT_ID}`]: { enabled: true, ownerUserId: 'left-the-project' } })
        const revision = await createPage(db)

        const result = await publishWikiRevisionFeed({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            revision,
        })

        expect(result.followerIds).toEqual([])
        expect(feedPaths(db).some(path => path.includes('left-the-project'))).toBe(false)
        expect(db.read(`feedsStore/${PROJECT_ID}/all/${result.feedId}`)).toBeDefined()
    })

    it('publishes nothing for a revision it cannot point at', async () => {
        const db = createDb()

        await expect(
            publishWikiRevisionFeed({ db, projectId: PROJECT_ID, slug: 'Not A Slug', revision: { revision: 1 } })
        ).resolves.toMatchObject({ published: false })
        await expect(
            publishWikiRevisionFeed({ db, projectId: PROJECT_ID, slug: 'kunden', revision: { revision: 0 } })
        ).resolves.toMatchObject({ published: false })
        expect(feedPaths(db).filter(path => !path.startsWith('projects/'))).toEqual([])
    })

    it('never fails the trigger', async () => {
        const db = createDb()
        db.doc = () => {
            throw new Error('Firestore is down')
        }
        const error = jest.spyOn(console, 'error').mockImplementation(() => {})

        await expect(
            onKnowledgePageRevisionCreated({ db, projectId: PROJECT_ID, slug: 'kunden', revision: { revision: 1 } })
        ).resolves.toMatchObject({ published: false, reason: 'error' })
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })
})

describe("the wiki's own changes in the unread badges (AT-2967)", () => {
    const DAY_LATER = NOW + 60 * 60 * 1000 // 2026-10-25 00:30 UTC: the next day where the function runs

    async function updatePage(db, expectedRevision, now) {
        await writeKnowledgePage({
            db,
            projectId: PROJECT_ID,
            slug: 'kunden-und-partner',
            title: 'Kunden und Partner',
            summary: 'Wer mit dem Projekt arbeitet.',
            body: `## Acme\nStand ${expectedRevision + 1} [[task:t1]].`,
            sourceKeys: ['task:t1'],
            allowedSourceKeys: new Set(['task:t1']),
            expectedRevision,
            reason: 'Neuer Stand',
            runId: `run-${expectedRevision + 1}`,
            now,
            fieldValue,
        })
        return db.read(revisionPath('kunden-und-partner', expectedRevision + 1))
    }

    const publish = (db, revision) =>
        publishWikiRevisionFeed({ db, projectId: PROJECT_ID, slug: 'kunden-und-partner', revision })
    const wikiCounter = (db, userId, tab) => db.read(`feedsCount/${PROJECT_ID}/${userId}/${tab}`)?.wiki?.wiki

    it('badges every member once, in one shared slot per project', async () => {
        const db = createDb()

        const result = await publish(db, await createPage(db))

        expect(result.notifiedIds.sort()).toEqual([MEMBER, OTHER, OWNER].sort())
        // The owner follows the wiki, so their badge is in Followed; the others' are in All.
        expect(wikiCounter(db, OWNER, 'followed')).toEqual({
            wiki_automatic: {
                dateFormated: '24102026',
                feed: expect.objectContaining({ wikiSlug: 'kunden-und-partner', wikiRevision: 1 }),
            },
        })
        expect(Object.keys(wikiCounter(db, MEMBER, 'all'))).toEqual(['wiki_automatic'])
        expect(Object.keys(wikiCounter(db, OTHER, 'all'))).toEqual(['wiki_automatic'])
        expect(feedPaths(db).some(path => path.includes('ws@'))).toBe(false)
    })

    it('adds no second unread line for later changes that day, but still lists them', async () => {
        const db = createDb()
        await publish(db, await createPage(db))

        const result = await publish(db, await updatePage(db, 1, NOW + 5000))

        expect(result.notifiedIds).toEqual([])
        expect(Object.keys(wikiCounter(db, OWNER, 'followed'))).toEqual(['wiki_automatic'])
        expect(wikiCounter(db, OWNER, 'followed').wiki_automatic.feed.wikiRevision).toBe(1)
        expect(db.read(`feedsStore/${PROJECT_ID}/all/${buildWikiFeedId('kunden-und-partner', 2)}`)).toBeDefined()
    })

    it('replaces an unread slot from an earlier day instead of adding to it', async () => {
        const db = createDb()
        await publish(db, await createPage(db))

        const result = await publish(db, await updatePage(db, 1, DAY_LATER))

        expect(result.notifiedIds.sort()).toEqual([MEMBER, OTHER, OWNER].sort())
        expect(wikiCounter(db, MEMBER, 'all')).toEqual({
            wiki_automatic: { dateFormated: '25102026', feed: expect.objectContaining({ wikiRevision: 2 }) },
        })
    })

    it('badges a member again the same day once they have read the first line', async () => {
        const db = createDb()
        await publish(db, await createPage(db))
        // Opening Updates deletes that tab's counter (resetAllNewFeeds).
        db.documents.delete(`feedsCount/${PROJECT_ID}/${OWNER}/followed`)

        const result = await publish(db, await updatePage(db, 1, NOW + 5000))

        expect(result.notifiedIds).toEqual([OWNER])
        expect(wikiCounter(db, OWNER, 'followed').wiki_automatic.feed.wikiRevision).toBe(2)
    })

    it('still badges when the slots cannot be read', async () => {
        const db = createDb()
        const revision = await createPage(db)
        db.getAll = async () => {
            throw new Error('Firestore is slow')
        }
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        const result = await publish(db, revision)

        expect(result.notifiedIds.sort()).toEqual([MEMBER, OTHER, OWNER].sort())
        expect(Object.keys(wikiCounter(db, OTHER, 'all'))).toEqual(['wiki_automatic'])
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })
})

describe('getWikiFeedTarget', () => {
    it('only points at a valid slug and revision, whatever a feed document claims', () => {
        const feed = { type: FEED_WIKI_PAGE_CHANGED, wikiSlug: 'kunden', wikiRevision: 3, wikiChange: 'corrected' }

        expect(getWikiFeedTarget(feed)).toEqual({ slug: 'kunden', revision: 3, change: 'corrected' })
        expect(getWikiFeedTarget({ ...feed, wikiChange: 'something-else' }).change).toBe('updated')
        expect(getWikiFeedTarget({ ...feed, wikiSlug: '../../users/x' })).toBeNull()
        expect(getWikiFeedTarget({ ...feed, wikiRevision: '3; drop' })).toBeNull()
        expect(getWikiFeedTarget({ ...feed, type: 'FEED_NOTE_UPDATED' })).toBeNull()
    })
})
