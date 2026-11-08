jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))

const { runGrowthScoreboard, METRICS_DAYS_COLLECTION, STATE_DOC } = require('./growthScoreboard')
const { runGrowthScoreboardJob } = require('./growthScoreboardJob')
const { publishScoreboardArtifact, renderScoreboardHtml } = require('./growthScoreboardArtifact')
const { SCOREBOARD_ARTIFACT_TARGETS } = require('./growthConfig')

const DAY = 24 * 60 * 60 * 1000
// Monday 09.11.2026 03:30 UTC: reports Sunday 08.11 and computes the weekly margin.
const MONDAY = Date.UTC(2026, 10, 9, 3, 30)
const TUESDAY = MONDAY + DAY
const REPORT_DAY_START = Date.UTC(2026, 10, 8)
const GROWTH_PROJECT = SCOREBOARD_ARTIFACT_TARGETS.production.projectId

const millis = value => {
    if (value instanceof Date) return value.getTime()
    if (value && typeof value.toMillis === 'function') return value.toMillis()
    return value
}
const getField = (data, field) => field.split('.').reduce((node, key) => (node == null ? undefined : node[key]), data)

// The Admin SDK surface the scoreboard uses, in memory; counts every document a query returns.
function createFakeDb(initial) {
    const docs = new Map(Object.entries(initial).map(([path, data]) => [path, JSON.parse(JSON.stringify(data))]))
    const snapshotOf = path => ({
        id: path.split('/').pop(),
        exists: docs.has(path),
        data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined),
    })
    const docRef = path => ({
        path,
        get: async () => snapshotOf(path),
        set: async (data, options) => {
            const next = JSON.parse(JSON.stringify(data))
            docs.set(path, options && options.merge ? { ...(docs.get(path) || {}), ...next } : next)
        },
    })
    const query = (path, filters = [], max = Infinity) => {
        const run = () => {
            const prefix = `${path}/`
            return [...docs.keys()]
                .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .filter(key =>
                    filters.every(([field, op, value]) => {
                        const actual = millis(getField(docs.get(key), field))
                        const expected = millis(value)
                        if (op === '==') return actual === expected
                        if (op === '>=') return actual >= expected
                        if (op === '<') return actual < expected
                        throw new Error(`Unsupported operator ${op}`)
                    })
                )
                .slice(0, max)
                .map(snapshotOf)
        }
        return {
            where: (field, op, value) => query(path, [...filters, [field, op, value]], max),
            select: () => query(path, filters, max),
            limit: n => query(path, filters, n),
            get: async () => {
                const result = run()
                return { size: result.length, empty: result.length === 0, docs: result }
            },
            count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
        }
    }
    return {
        docs,
        doc: docRef,
        collection: path => query(path),
        getAll: async (...refs) => refs.map(ref => snapshotOf(ref.path)),
    }
}

function createWorld() {
    const short = REPORT_DAY_START - 7 * DAY + 3600000
    const long = REPORT_DAY_START - 14 * DAY + 3600000
    const authUsers = [
        { uid: 'u-new', email: 'new@example.com', providerData: [{}], created: REPORT_DAY_START + 3600000 },
        { uid: 'u-new-plain', email: 'plain@example.com', providerData: [{}], created: REPORT_DAY_START + 7200000 },
        { uid: 'anon', providerData: [], created: REPORT_DAY_START + 3600000 },
        { uid: 'u-short', email: 's@example.com', providerData: [{}], created: short },
        { uid: 'u-long', email: 'l@example.com', providerData: [{}], created: long },
        { uid: 'p-stripe', email: 'p@example.com', providerData: [{}], created: Date.UTC(2025, 0, 1) },
        { uid: 'p-apple', email: 'a@example.com', providerData: [{}], created: MONDAY - 20 * DAY },
        { uid: 'admin', email: 'k@example.com', providerData: [{}], created: Date.UTC(2020, 4, 6) },
    ]
    const auth = {
        listUsers: jest.fn(async (max, pageToken) => {
            const page = pageToken ? authUsers.slice(4) : authUsers.slice(0, 4)
            return {
                users: page.map(user => ({
                    uid: user.uid,
                    email: user.email,
                    providerData: user.providerData,
                    metadata: { creationTime: new Date(user.created).toUTCString() },
                })),
                pageToken: pageToken ? undefined : 'page-2',
            }
        }),
    }

    const gold = (uid, id, data) => [`users/${uid}/goldTransactions/${id}`, data]
    const db = createFakeDb({
        'roles/administrator': { userId: 'admin' },
        'users/u-new': { projectIds: ['p-new'], lastLogin: MONDAY - 1000 },
        'users/u-new/private/signupAttribution': { version: 1, utmSource: 'LinkedIn', utmCampaign: 'Segment A' },
        'users/u-new-plain': { projectIds: [], lastLogin: MONDAY - 3 * DAY },
        'users/u-short': { projectIds: ['p-short'], lastLogin: MONDAY - 2 * DAY, phone: '+49170000' },
        'users/u-short/private/signupAttribution': { version: 1, referrerHost: 'news.ycombinator.com' },
        'items/p-short/tasks/t-setup': { creatorId: 'u-short', created: short + 1000 },
        'items/p-short/tasks/t-own': { creatorId: 'u-short', created: short + 3 * 3600000 },
        'users/u-long': { projectIds: [], lastLogin: MONDAY - 40 * DAY },
        'users/p-stripe': {
            premium: { status: 'premium', planInterval: 'month' },
            stripeCustomerId: 'cus_p',
            lastLogin: MONDAY - 1000,
        },
        'users/p-apple': {
            premium: { status: 'premium', source: 'apple_iap', planInterval: 'year' },
            lastLogin: MONDAY - 1000,
        },
        'users/admin': { premium: { status: 'premium' }, lastLogin: MONDAY - 1000 },
        ...Object.fromEntries([
            gold('u-short', 'g1', {
                direction: 'spend',
                source: 'assistant_usage',
                amount: 5,
                createdAt: short + 4 * 3600000,
            }),
            gold('u-long', 'g1', {
                direction: 'spend',
                source: 'assistant_usage',
                amount: 5,
                createdAt: long + 1 * DAY,
            }),
            gold('u-long', 'g2', { direction: 'spend', source: 'vm_execution', amount: 50, createdAt: long + 2 * DAY }),
            gold('u-long', 'g3', {
                direction: 'spend',
                source: 'gmail_labeling',
                amount: 1,
                createdAt: long + 5 * DAY,
            }),
            gold('p-stripe', 'g1', {
                direction: 'spend',
                source: 'vm_execution',
                amount: 10000,
                createdAt: MONDAY - 5 * DAY,
            }),
            gold('p-stripe', 'g2', {
                direction: 'refund',
                source: 'vm_execution_refund',
                amount: 1000,
                createdAt: MONDAY - 5 * DAY,
            }),
            gold('admin', 'g1', {
                direction: 'spend',
                source: 'vm_execution',
                amount: 900000,
                createdAt: MONDAY - DAY,
            }),
        ]),
        'goldStats/daily/days/2026-11-08': {
            spend: 1500,
            earn: 2000,
            refund: 20,
            spendBySource: { vm_execution: 1000, assistant_usage: 500 },
            earnBySource: { monthly_gold: 2000 },
            spendByBilling: { vm_execution__exempt: 400 },
        },
        'revenueEvents/revenuecat_e1': {
            provider: 'apple',
            kind: 'subscription',
            userId: 'p-apple',
            productId: 'alldone_premium_yearly',
            priceUsd: 99.99,
            taxShare: 0.16,
            commissionShare: 0.15,
            environment: 'PRODUCTION',
            eventAt: MONDAY - 10 * DAY,
        },
        'revenueEvents/revenuecat_sandbox': {
            provider: 'apple',
            kind: 'subscription',
            userId: 'p-apple',
            priceUsd: 50,
            environment: 'SANDBOX',
            eventAt: REPORT_DAY_START + 1000,
        },
        [`projects/${GROWTH_PROJECT}`]: {
            contactStatuses: {
                s2: { name: 'reached out', sortIndex: 2 },
                s1: { name: 'new idea/potential', sortIndex: 1 },
            },
        },
        [`projectsContacts/${GROWTH_PROJECT}/contacts/c1`]: { contactStatusId: 's1', email: 'prospect@example.com' },
        [`projectsContacts/${GROWTH_PROJECT}/contacts/c2`]: { contactStatusId: 's1' },
        [`projectsContacts/${GROWTH_PROJECT}/contacts/c3`]: { contactStatusId: 's2' },
        [`projectsContacts/${GROWTH_PROJECT}/contacts/c4`]: {},
    })

    const transactions = [
        // Monthly subscription paid on the report day.
        {
            id: 'txn_sub',
            type: 'charge',
            amount: 1190,
            fee: 40,
            currency: 'eur',
            created: (REPORT_DAY_START + 5000) / 1000,
            source: { invoice: 'in_1', customer: 'cus_p' },
        },
        {
            id: 'txn_fee',
            type: 'stripe_fee',
            amount: -100,
            fee: 0,
            currency: 'eur',
            created: (REPORT_DAY_START + 6000) / 1000,
        },
        // A Gold pack bought by the administrator a week ago.
        {
            id: 'txn_admin',
            type: 'charge',
            amount: 999,
            fee: 30,
            currency: 'eur',
            created: (MONDAY - 7 * DAY) / 1000,
            source: { customer: 'cus_admin' },
        },
    ]
    const stripe = {
        balanceTransactions: {
            list: jest.fn(async ({ created }) => ({
                data: transactions.filter(txn => txn.created >= created.gte && txn.created < created.lt),
                has_more: false,
            })),
        },
        charges: { retrieve: jest.fn() },
    }
    db.docs.set('users/admin', { ...db.docs.get('users/admin'), stripeCustomerId: 'cus_admin' })

    const analytics = {
        listProperties: async () => [{ property: 'properties/1', displayName: 'alldone.app' }],
        runReport: async (property, body) =>
            body.dimensions[0].name === 'eventName'
                ? { rows: [{ dimensionValues: [{ value: 'sign_up' }], metricValues: [{ value: '1' }] }] }
                : {
                      rows: [
                          {
                              dimensionValues: ['alldone.app', 'linkedin', 'social', 'segment-a'].map(value => ({
                                  value,
                              })),
                              metricValues: ['12', '10', '9'].map(value => ({ value })),
                          },
                      ],
                  },
    }
    return { db, auth, stripe, analytics }
}

const run = (world, now, options = {}, environment = 'production') =>
    runGrowthScoreboard(options, { ...world, now: () => now, environment })

describe('growth scoreboard daily run', () => {
    test('writes one aggregate document for yesterday, with every step of the funnel', async () => {
        const world = createWorld()
        const { metrics } = await run(world, MONDAY)
        const stored = world.db.docs.get(`${METRICS_DAYS_COLLECTION}/2026-11-08`)
        expect(stored).toEqual(metrics)

        expect(metrics.outreach).toEqual({
            contacts: 4,
            byStatus: [
                { name: 'new idea/potential', count: 2 },
                { name: 'reached out', count: 1 },
            ],
            withoutStatus: 1,
        })
        expect(metrics.traffic).toMatchObject({ connected: true, sessions: 12, signupEvents: 1, visibleShare: 0.5 })
        // The anonymous visitor is not a signup; the signup without a recorded origin is "unknown".
        expect(metrics.signups).toEqual({
            count: 2,
            withAttribution: 1,
            bySource: { linkedin: 1, unknown: 1 },
            byCampaign: { 'segment-a': 1 },
        })
        expect(metrics.activation.shortCohort).toMatchObject({
            day: '2026-11-01',
            signups: 1,
            taskAndAssistantReply: 1,
            connectedIntegration: 1,
            bySource: { 'news-ycombinator-com': { signups: 1, taskAndAssistantReply: 1, connectedIntegration: 1 } },
        })
        expect(metrics.activation.longCohort).toMatchObject({ day: '2026-10-25', signups: 1, goldOnThreeDays: 1 })
        expect(metrics.activeUsers).toEqual({ day: 4, week: 6, month: 6 })
        expect(metrics.premium).toMatchObject({
            payingUsers: 3,
            byPlan: { stripe: 2, apple: 1 },
            started: null,
            stopped: null,
        })
        // Day revenue: the subscription after Stripe's fee and estimated VAT, minus a Stripe fee;
        // the sandbox event is not revenue.
        expect(metrics.revenue.byKind.subscription.count).toBe(1)
        expect(metrics.revenue.byKind.fee.netEur).toBe(-1)
        expect(metrics.revenue.byProvider.apple).toBeUndefined()
        expect(metrics.gold).toMatchObject({ available: true, spent: 1500 })
        expect(metrics.gold.estimatedCostEur).toBeGreaterThan(0)
        expect(metrics.run.firestoreDocs).toBeGreaterThan(0)
        expect(metrics.run.authPages).toBe(2)
    })

    test('stores no email, name or user id in the day document', async () => {
        const world = createWorld()
        await run(world, MONDAY)
        const text = JSON.stringify(world.db.docs.get(`${METRICS_DAYS_COLLECTION}/2026-11-08`))
        expect(text).not.toMatch(/@example\.com/)
        ;['u-new', 'u-short', 'u-long', 'p-stripe', 'p-apple', 'admin', 'cus_p'].forEach(id => {
            expect(text).not.toContain(`"${id}"`)
        })
    })

    test('the weekly margin spreads payments over their period and leaves the team out', async () => {
        const world = createWorld()
        const { metrics } = await run(world, MONDAY)
        const margin = metrics.margin
        expect(margin.windowDays).toBe(90)
        // The administrator's huge VM spend and Gold pack are not a customer's.
        expect(margin.payingUsers).toBe(2)
        expect(margin.byPlan.stripe.payingUsers).toBe(1)
        expect(margin.byPlan.apple.payingUsers).toBe(1)
        // A yearly Apple plan paid 10 days ago counts with 10/365 of its net.
        expect(margin.byPlan.apple.revenueEur).toBeCloseTo((99.99 * 0.84 * 0.85 * 0.87 * 10) / 365, 1)
        expect(margin.byPlan.stripe.costEur).toBeGreaterThan(0)
        expect(world.db.docs.get(STATE_DOC).latestMarginDay).toBe('2026-11-08')
    })

    test('no margin outside Mondays; started and stopped come from the previous snapshot', async () => {
        const world = createWorld()
        await run(world, MONDAY)
        world.db.docs.set('users/p-new', { premium: { status: 'premium' }, lastLogin: TUESDAY })
        world.db.docs.set('users/p-apple', { premium: { status: 'free' } })

        const { metrics } = await run(world, TUESDAY)
        expect(metrics.margin).toBe(null)
        expect(metrics.premium).toMatchObject({ payingUsers: 3, started: 1, stopped: 1 })

        // Running the same day again compares with the same earlier snapshot, not with itself.
        const rerun = await run(world, TUESDAY)
        expect(rerun.metrics.premium).toMatchObject({ started: 1, stopped: 1 })
        expect(world.db.docs.get(STATE_DOC).latestMarginDay).toBe('2026-11-08')
    })

    test('staging reads no Growth project, and a missing Stripe or GA leaves a note instead of failing', async () => {
        const world = createWorld()
        world.stripe = null
        world.analytics = { listProperties: async () => [] }
        const { metrics } = await run(world, TUESDAY, {}, 'staging')
        expect(metrics.outreach).toBe(null)
        expect(metrics.revenue.stripeAvailable).toBe(false)
        expect(metrics.traffic.connected).toBe(false)
    })

    test('refuses a malformed day', async () => {
        await expect(run(createWorld(), MONDAY, { day: '08.11.2026' })).rejects.toThrow('Invalid report day')
    })
})

describe('growth scoreboard artifact', () => {
    test('escapes every value and keeps the data block inert', () => {
        const html = renderScoreboardHtml({
            latest: {
                day: '2026-11-08',
                signups: { count: 1, bySource: { '<img src=x onerror=alert(1)>': 1 } },
                traffic: { connected: false, reason: '</script><script>alert(1)</script>' },
            },
            history: [],
            generatedAt: MONDAY,
        })
        expect(html).not.toContain('<img src=x')
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
        const dataBlock = html.slice(html.indexOf('id="growth-scoreboard-data">'))
        expect(dataBlock).not.toContain('</script><script>')
        expect(html.match(/<script/g)).toHaveLength(1)
    })

    test('creates the artifact once, then adds versions; recreates it when it was deleted', async () => {
        const commit = jest.fn(async input => ({ artifactId: input.artifactId || 'art-new' }))
        const base = { html: '<p>x</p>', day: '2026-11-08', environment: 'production', commit }

        expect(await publishScoreboardArtifact({ ...base, artifactId: null })).toBe('art-new')
        expect(commit.mock.calls[0][0]).toMatchObject({
            userId: SCOREBOARD_ARTIFACT_TARGETS.production.ownerUserId,
            projectId: GROWTH_PROJECT,
            isPrivate: true,
            title: 'Growth Scoreboard',
            files: [{ path: 'index.html', base64: Buffer.from('<p>x</p>').toString('base64') }],
        })
        expect(await publishScoreboardArtifact({ ...base, artifactId: 'art-1' })).toBe('art-1')

        const gone = jest.fn(async input => {
            if (input.artifactId) throw Object.assign(new Error('Artifact not found.'), { code: 'not-found' })
            return { artifactId: 'art-2' }
        })
        expect(await publishScoreboardArtifact({ ...base, artifactId: 'art-1', commit: gone })).toBe('art-2')

        const broken = jest.fn(async () => {
            throw Object.assign(new Error('aborted'), { code: 'aborted' })
        })
        await expect(publishScoreboardArtifact({ ...base, artifactId: 'art-1', commit: broken })).rejects.toThrow(
            'aborted'
        )
        expect(broken).toHaveBeenCalledTimes(1)

        expect(await publishScoreboardArtifact({ ...base, environment: 'staging' })).toBe(null)
    })

    test('the job remembers the artifact and survives a failed publish', async () => {
        const world = createWorld()
        const commit = jest.fn(async input => ({ artifactId: input.artifactId || 'art-new' }))
        const first = await runGrowthScoreboardJob(
            {},
            { ...world, now: () => MONDAY, environment: 'production', commitArtifactVersion: commit }
        )
        expect(first.artifactId).toBe('art-new')
        expect(world.db.docs.get(STATE_DOC).scoreboardArtifactId).toBe('art-new')
        const html = Buffer.from(commit.mock.calls[0][0].files[0].base64, 'base64').toString('utf8')
        expect(html).toContain('Funnel')
        expect(html).not.toMatch(/@example\.com/)

        const failing = jest.fn(async () => {
            throw new Error('storage down')
        })
        const second = await runGrowthScoreboardJob(
            {},
            { ...world, now: () => TUESDAY, environment: 'production', commitArtifactVersion: failing }
        )
        expect(second.metrics.day).toBe('2026-11-09')
        expect(world.db.docs.has(`${METRICS_DAYS_COLLECTION}/2026-11-09`)).toBe(true)
        expect(world.db.docs.get(STATE_DOC).scoreboardArtifactId).toBe('art-new')
    })
})
