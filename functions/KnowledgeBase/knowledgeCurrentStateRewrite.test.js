const { KnowledgeFirestoreDouble } = require('./__fixtures__/knowledgeFirestoreDouble')
const {
    readPendingRewriteSlugs,
    requestCurrentStateRewrite,
    selectPagesForCurrentStateRewrite,
} = require('./knowledgeCurrentStateRewrite')

const PROJECT_ID = 'project-a'
const KB_PATH = `knowledgeBases/${PROJECT_ID}`
const NOW = Date.UTC(2026, 9, 25, 12)
const pagePath = slug => `${KB_PATH}/pages/${slug}`

function createDb(knowledgeBase = {}, extra = {}) {
    return new KnowledgeFirestoreDouble({
        [KB_PATH]: { enabled: true, ownerUserId: 'owner', nextRunAt: NOW + 6 * 60 * 60 * 1000, ...knowledgeBase },
        [pagePath('kunden')]: { slug: 'kunden', title: 'Kunden', revision: 3 },
        [pagePath('hosting')]: { slug: 'hosting', title: 'Hosting', revision: 1 },
        [pagePath('alt')]: { slug: 'alt', title: 'Alt', revision: 4, archived: true },
        [pagePath('privat')]: { slug: 'privat', title: 'Privat', revision: 2, needsRebuild: true },
        ...extra,
    })
}

describe('selectPagesForCurrentStateRewrite', () => {
    it('takes every visible page, never an archived one or one waiting for a rebuild', () => {
        const pages = new Map([
            ['kunden', { slug: 'kunden' }],
            ['alt', { slug: 'alt', archived: true }],
            ['privat', { slug: 'privat', needsRebuild: true }],
            ['hosting', { slug: 'hosting' }],
        ])
        expect(selectPagesForCurrentStateRewrite(pages)).toEqual(['hosting', 'kunden'])
    })
})

describe('readPendingRewriteSlugs', () => {
    it('reads no request as null and normalizes what it does read', () => {
        expect(readPendingRewriteSlugs(undefined)).toBeNull()
        expect(readPendingRewriteSlugs({ requestedAt: NOW })).toBeNull()
        expect(readPendingRewriteSlugs({ pendingSlugs: ['Kunden', 'kunden', '', null, 'hosting'] })).toEqual([
            'kunden',
            'hosting',
        ])
    })
})

describe('requestCurrentStateRewrite', () => {
    it('stores the visible pages and makes the wiki due now', async () => {
        const db = createDb()

        const result = await requestCurrentStateRewrite({ db, projectId: PROJECT_ID, now: NOW })

        expect(result).toEqual({ requested: true, reason: null, slugs: ['hosting', 'kunden'] })
        expect(db.read(KB_PATH)).toMatchObject({
            currentStateRewrite: { requestedAt: NOW, pendingSlugs: ['hosting', 'kunden'] },
            nextRunAt: NOW,
        })
    })

    it('keeps a due date that is already earlier', async () => {
        const db = createDb({ nextRunAt: NOW - 1000 })

        await requestCurrentStateRewrite({ db, projectId: PROJECT_ID, now: NOW })

        expect(db.read(KB_PATH).nextRunAt).toBe(NOW - 1000)
    })

    it('writes nothing on a dry run', async () => {
        const db = createDb()
        const before = db.read(KB_PATH)

        const result = await requestCurrentStateRewrite({ db, projectId: PROJECT_ID, now: NOW, dryRun: true })

        expect(result).toEqual({ requested: false, reason: 'dry_run', slugs: ['hosting', 'kunden'] })
        expect(db.read(KB_PATH)).toEqual(before)
    })

    it('never touches a disabled wiki, which would otherwise become due again', async () => {
        const db = createDb({ enabled: false, nextRunAt: null })

        const result = await requestCurrentStateRewrite({ db, projectId: PROJECT_ID, now: NOW })

        expect(result.reason).toBe('disabled')
        expect(db.read(KB_PATH)).not.toHaveProperty('currentStateRewrite')
        expect(db.read(KB_PATH).nextRunAt).toBeNull()
    })

    it('leaves a pass that is still pending alone unless forced', async () => {
        const pending = { requestedAt: NOW - 1000, pendingSlugs: ['kunden'] }
        const db = createDb({ currentStateRewrite: pending })

        const result = await requestCurrentStateRewrite({ db, projectId: PROJECT_ID, now: NOW })
        expect(result).toEqual({ requested: false, reason: 'already_requested', slugs: ['kunden'] })
        expect(db.read(KB_PATH).currentStateRewrite).toEqual(pending)

        await requestCurrentStateRewrite({ db, projectId: PROJECT_ID, now: NOW, force: true })
        expect(db.read(KB_PATH).currentStateRewrite).toEqual({ requestedAt: NOW, pendingSlugs: ['hosting', 'kunden'] })
    })

    it('asks for nothing when the wiki has no visible page', async () => {
        const db = new KnowledgeFirestoreDouble({
            [KB_PATH]: { enabled: true, nextRunAt: NOW + 1000 },
            [pagePath('alt')]: { slug: 'alt', archived: true },
        })

        const result = await requestCurrentStateRewrite({ db, projectId: PROJECT_ID, now: NOW })

        expect(result).toEqual({ requested: false, reason: 'no_pages', slugs: [] })
        expect(db.read(KB_PATH).nextRunAt).toBe(NOW + 1000)
    })
})
