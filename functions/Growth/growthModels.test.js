const fs = require('fs')
const path = require('path')

const {
    VM_INFRA_USD_PER_GOLD,
    VM_TOKEN_BASE_USD_PER_GOLD,
    DEFAULT_USD_PER_GOLD,
    estimateUsdPerGold,
    estimateTransactionCostUsd,
    estimateRollupCostUsdBySource,
} = require('./growthCostModel')
const {
    STRIPE_VAT_SHARE_OF_GROSS,
    buildRevenueCatRevenueEvent,
    normalizeAppleRevenueRow,
    normalizeStripeRevenueRow,
    readStripeRevenueRows,
    resolveStripeRowUsers,
    recognizedInWindow,
    summarizeRevenue,
} = require('./growthRevenue')
const {
    resolveSignupSource,
    resolveSignupCampaign,
    evaluateActivation,
    getConnectedIntegrations,
    summarizeCohort,
    capBreakdown,
    DAY_MS,
} = require('./growthSignups')
const { summarizeMargins, percentile } = require('./growthMargin')
const { createAnalyticsClient, summarizePropertyReports, readTraffic } = require('./growthTraffic')
const { VM_GOLD_PER_MINUTE, FX_TO_EUR, MAX_BREAKDOWN_KEYS } = require('./growthConfig')

const SIGNUP = Date.UTC(2026, 10, 1, 9, 0, 0)

describe('growth cost model (estimates)', () => {
    test('keeps the VM minute price in step with what vmJob.js charges', () => {
        const source = fs.readFileSync(path.join(__dirname, '../Assistant/vmJob.js'), 'utf8')
        expect(Number(source.match(/const VM_GOLD_PER_MINUTE = (\d+)/)[1])).toBe(VM_GOLD_PER_MINUTE)
    })

    test('prices each kind of Gold on its own basis', () => {
        expect(estimateUsdPerGold({ source: 'rage_mode_item' })).toEqual({ usdPerGold: 0, basis: 'none' })
        expect(estimateUsdPerGold({ source: 'vm_execution', billingExempt: true })).toEqual({
            usdPerGold: VM_INFRA_USD_PER_GOLD,
            basis: 'vm_infra',
        })
        const vmBilled = estimateUsdPerGold({ source: 'vm_execution', model: 'opus', billingExempt: false })
        expect(vmBilled.basis).toBe('vm_conservative')
        expect(vmBilled.usdPerGold).toBeGreaterThanOrEqual(Math.max(VM_INFRA_USD_PER_GOLD, VM_TOKEN_BASE_USD_PER_GOLD))
        expect(estimateUsdPerGold({ source: 'assistant_usage', model: 'MODEL_GPT6_LUNA' }).basis).toBe('model_tokens')
        expect(estimateUsdPerGold({ source: 'assistant_usage', model: 'MODEL_GPT6_LUNA' }).usdPerGold).toBeLessThan(
            estimateUsdPerGold({ source: 'assistant_usage', model: 'MODEL_GPT6_SOL' }).usdPerGold
        )
        expect(estimateUsdPerGold({ source: 'mcp_tool_call' })).toEqual({
            usdPerGold: DEFAULT_USD_PER_GOLD,
            basis: 'source_default',
        })
        // A legacy model key resolves to its current product.
        expect(estimateUsdPerGold({ source: 'assistant_usage', model: 'MODEL_GPT5_6_SOL' }).basis).toBe('model_tokens')
    })

    test('a refund gives the cost back and an earn costs nothing', () => {
        const spend = estimateTransactionCostUsd({ direction: 'spend', amount: 100, source: 'vm_execution' })
        const refund = estimateTransactionCostUsd({ direction: 'refund', amount: 100, source: 'vm_execution_refund' })
        expect(spend).toBeGreaterThan(0)
        expect(refund).toBeCloseTo(-spend)
        expect(estimateTransactionCostUsd({ direction: 'earn', amount: 1000, source: 'monthly_gold' })).toBe(0)
        expect(estimateTransactionCostUsd({ direction: 'spend', amount: 'x' })).toBe(0)
    })

    test('prices a day rollup by billing route and by model, net of refunds', () => {
        const costs = estimateRollupCostUsdBySource({
            spendBySource: { vm_execution: 1000, assistant_usage: 500, rage_mode_item: 100 },
            spendByBilling: { vm_execution__exempt: 400 },
            spendByModel: { assistant_usage__model_gpt6_luna: 200 },
            refundBySource: { vm_execution_refund: 20 },
        })
        const luna = estimateUsdPerGold({ source: 'assistant_usage', model: 'MODEL_GPT6_LUNA' }).usdPerGold
        const billedVm = estimateUsdPerGold({ source: 'vm_execution', billingExempt: false }).usdPerGold
        expect(costs.assistant_usage).toBeCloseTo(200 * luna + 300 * DEFAULT_USD_PER_GOLD)
        expect(costs.vm_execution).toBeCloseTo(400 * VM_INFRA_USD_PER_GOLD + 600 * billedVm - 20 * billedVm)
        expect(costs.rage_mode_item).toBeUndefined()
    })
})

describe('growth revenue (actual payments)', () => {
    test('records a RevenueCat event only when it carries a price', () => {
        expect(buildRevenueCatRevenueEvent({ id: 'e1', type: 'CANCELLATION' })).toBe(null)
        expect(buildRevenueCatRevenueEvent({ id: 'e2', type: 'RENEWAL', price: 0 })).toBe(null)
        expect(buildRevenueCatRevenueEvent({ type: 'RENEWAL', price: 9.99 })).toBe(null)

        const renewal = buildRevenueCatRevenueEvent(
            {
                id: 'e3',
                type: 'RENEWAL',
                app_user_id: 'uid-1',
                product_id: 'alldone_premium_yearly:promo',
                price: 99.99,
                price_in_purchased_currency: 109.99,
                currency: 'EUR',
                tax_percentage: 0.1597,
                commission_percentage: 0.15,
                environment: 'PRODUCTION',
                event_timestamp_ms: 1700000000000,
            },
            { now: 5 }
        )
        expect(renewal).toMatchObject({
            provider: 'apple',
            kind: 'subscription',
            userId: 'uid-1',
            productId: 'alldone_premium_yearly',
            priceUsd: 99.99,
            taxShare: 0.1597,
            commissionShare: 0.15,
            eventAt: 1700000000000,
        })
        expect(buildRevenueCatRevenueEvent({ id: 'e4', type: 'CANCELLATION', price: -9.99 }).kind).toBe('refund')
        expect(buildRevenueCatRevenueEvent({ id: 'e5', type: 'NON_RENEWING_PURCHASE', price: 9.99 }).kind).toBe(
            'one_time'
        )
        // An app user id that is a path is never used as a user id.
        expect(buildRevenueCatRevenueEvent({ id: 'e6', type: 'RENEWAL', price: 1, app_user_id: 'a/b' }).userId).toBe(
            null
        )
    })

    test('an Apple row deducts its tax and commission, with defaults only when missing', () => {
        const row = normalizeAppleRevenueRow({
            priceUsd: 100,
            taxShare: 0.2,
            commissionShare: 0.3,
            kind: 'subscription',
            productId: 'alldone_premium_monthly',
        })
        expect(row.taxEur).toBeCloseTo(20 * FX_TO_EUR.USD)
        expect(row.feeEur).toBeCloseTo(24 * FX_TO_EUR.USD)
        expect(row.netEur).toBeCloseTo(56 * FX_TO_EUR.USD)
        expect(row.periodDays).toBe(30)
        expect(row.estimated).toBe(false)
        expect(normalizeAppleRevenueRow({ priceUsd: 100 }).estimated).toBe(true)
    })

    test('a Stripe balance transaction becomes a row with its real fee and estimated VAT', () => {
        const subscription = normalizeStripeRevenueRow({
            type: 'charge',
            amount: 1190,
            fee: 50,
            currency: 'eur',
            created: 1700000000,
            source: { invoice: 'in_1', customer: 'cus_1', payment_intent: 'pi_1' },
        })
        expect(subscription).toMatchObject({ kind: 'subscription', customerId: 'cus_1', grossEur: 11.9, feeEur: 0.5 })
        expect(subscription.taxEur).toBeCloseTo(11.9 * STRIPE_VAT_SHARE_OF_GROSS)
        expect(subscription.netEur).toBeCloseTo(11.9 - 0.5 - 11.9 * STRIPE_VAT_SHARE_OF_GROSS)

        expect(
            normalizeStripeRevenueRow({ type: 'charge', amount: 999, fee: 30, currency: 'eur', source: {} }).kind
        ).toBe('one_time')
        const refund = normalizeStripeRevenueRow({
            type: 'refund',
            amount: -999,
            fee: 0,
            currency: 'eur',
            source: { charge: 'ch_1' },
        })
        expect(refund).toMatchObject({ kind: 'refund', chargeId: 'ch_1' })
        expect(refund.netEur).toBeLessThan(0)
        const fee = normalizeStripeRevenueRow({ type: 'stripe_fee', amount: -200, fee: 0, currency: 'eur' })
        expect(fee).toMatchObject({ kind: 'fee', grossEur: 0, feeEur: 2, netEur: -2, taxEur: 0 })
        expect(normalizeStripeRevenueRow({ type: 'payout', amount: -5000, fee: 0, currency: 'eur' }).kind).toBe('other')
        expect(
            normalizeStripeRevenueRow({ type: 'charge', amount: 100, fee: 0, currency: 'chf', source: {} }).netEur
        ).toBe(null)
    })

    test('reads every page of balance transactions and says when Stripe is not configured', async () => {
        const pages = [
            {
                data: [{ id: 'txn_1', type: 'charge', amount: 100, fee: 3, currency: 'eur', source: {} }],
                has_more: true,
            },
            {
                data: [{ id: 'txn_2', type: 'charge', amount: 200, fee: 6, currency: 'eur', source: {} }],
                has_more: false,
            },
        ]
        const list = jest.fn(async () => pages.shift())
        const result = await readStripeRevenueRows({ stripe: { balanceTransactions: { list } }, from: 0, to: 86400000 })
        expect(result.rows).toHaveLength(2)
        expect(result.apiPages).toBe(2)
        expect(list.mock.calls[1][0]).toMatchObject({ starting_after: 'txn_1', expand: ['data.source'] })
        expect(await readStripeRevenueRows({ stripe: null, from: 0, to: 1 })).toMatchObject({
            rows: [],
            unavailable: true,
        })
    })

    test('matches Stripe rows to users by customer, Gold pack payment or refunded charge', async () => {
        const db = {
            collection: name => ({
                where: (field, op, value) => ({
                    limit: () => ({
                        get: async () => {
                            const hit =
                                (name === 'users' &&
                                    value === 'cus_known' && { id: 'uid-customer', data: () => ({}) }) ||
                                (name === 'stripeGoldFulfillments' &&
                                    value === 'pi_gold' && { id: 'f1', data: () => ({ userId: 'uid-gold' }) })
                            return { empty: !hit, size: hit ? 1 : 0, docs: hit ? [hit] : [] }
                        },
                    }),
                }),
            }),
        }
        const stripe = { charges: { retrieve: async () => ({ customer: 'cus_known' }) } }
        const rows = [
            { kind: 'subscription', customerId: 'cus_known' },
            { kind: 'one_time', paymentIntentId: 'pi_gold' },
            { kind: 'refund', chargeId: 'ch_1' },
            { kind: 'one_time', customerId: 'cus_unknown' },
            { kind: 'fee' },
        ]
        const result = await resolveStripeRowUsers(rows, { db, stripe })
        expect(rows.map(row => row.userId)).toEqual(['uid-customer', 'uid-gold', 'uid-customer', null, undefined])
        expect(result.apiCalls).toBe(1)
    })

    test('spreads a subscription payment over the period it pays for', () => {
        const day = 24 * 60 * 60 * 1000
        const window = { from: 100 * day, to: 190 * day }
        expect(
            recognizedInWindow({ kind: 'subscription', netEur: 365, createdAt: 0 }, { ...window, periodDays: 365 })
        ).toBeCloseTo(90)
        expect(
            recognizedInWindow(
                { kind: 'subscription', netEur: 30, createdAt: 185 * day },
                { ...window, periodDays: 30 }
            )
        ).toBeCloseTo(5)
        expect(
            recognizedInWindow({ kind: 'one_time', netEur: 9, createdAt: 150 * day }, { ...window, periodDays: 30 })
        ).toBe(9)
        expect(
            recognizedInWindow({ kind: 'one_time', netEur: 9, createdAt: 50 * day }, { ...window, periodDays: 30 })
        ).toBe(0)
        expect(recognizedInWindow({ kind: 'refund', netEur: null, createdAt: 150 * day }, window)).toBe(0)
    })

    test('summarizes rows by provider and kind, counting unmatched payments', () => {
        const summary = summarizeRevenue([
            {
                provider: 'stripe',
                kind: 'subscription',
                userId: 'u1',
                grossEur: 10,
                feeEur: 1,
                taxEur: 1.6,
                netEur: 7.4,
                estimated: true,
            },
            { provider: 'apple', kind: 'one_time', userId: null, grossEur: 5, feeEur: 0.7, taxEur: 0.8, netEur: 3.5 },
            { provider: 'stripe', kind: 'fee', grossEur: 0, feeEur: 2, taxEur: 0, netEur: -2 },
            { provider: 'stripe', kind: 'one_time', netEur: null },
        ])
        expect(summary).toMatchObject({ count: 3, netEur: 8.9, unresolvedUserCount: 1, estimatedCount: 1 })
        expect(summary.byProvider.stripe.count).toBe(2)
        expect(summary.byKind.fee.netEur).toBe(-2)
    })
})

describe('growth signups and activation', () => {
    test('one source per signup, re-sanitised because the owner can write the attribution', () => {
        expect(resolveSignupSource(null)).toBe('unknown')
        expect(resolveSignupSource({ utmSource: 'LinkedIn', referrerHost: 'x.com' })).toBe('linkedin')
        expect(resolveSignupSource({ ref: 'Partner.Agency' })).toBe('partner-agency')
        expect(resolveSignupSource({ clickSource: 'google_ads' })).toBe('google_ads')
        expect(resolveSignupSource({ referrerHost: 'news.ycombinator.com' })).toBe('news-ycombinator-com')
        expect(resolveSignupSource({ landingPath: '/projects/tpl/tasks' })).toBe('project-link')
        expect(resolveSignupSource({ landingPath: '/' })).toBe('direct')
        expect(resolveSignupSource({ utmSource: '<img src=x>'.repeat(10) }).length).toBeLessThanOrEqual(40)
        expect(resolveSignupSource({ utmSource: { toString: () => 'x' } })).toBe('direct')
        expect(resolveSignupCampaign({ utmCampaign: 'Segment A' })).toBe('segment-a')
    })

    test('the three activation candidates', () => {
        const hour = 60 * 60 * 1000
        const spend = (hoursAfter, source = 'assistant_usage') => ({
            direction: 'spend',
            source,
            createdAt: { toMillis: () => SIGNUP + hoursAfter * hour },
        })
        const active = evaluateActivation({
            signupAt: SIGNUP,
            taskCreatedAt: [SIGNUP + 30 * 1000, SIGNUP + 3 * hour],
            goldTransactions: [spend(4), spend(30, 'vm_execution'), spend(60, 'gmail_labeling')],
            userData: { apisConnected: { p1: { calendar: true } } },
        })
        expect(active).toEqual({ taskAndAssistantReply: true, connectedIntegration: true, goldOnThreeDays: true })

        const inactive = evaluateActivation({
            signupAt: SIGNUP,
            // Only the task signup creates itself, a reply after day 7, game items on three days.
            taskCreatedAt: [SIGNUP + 30 * 1000],
            goldTransactions: [
                spend(8 * 24),
                spend(1, 'rage_mode_item'),
                spend(30, 'rage_mode_item'),
                spend(60, 'rage_mode_item'),
            ],
            userData: { apisConnected: { p1: { calendar: false } }, phone: '  ' },
        })
        expect(inactive).toEqual({ taskAndAssistantReply: false, connectedIntegration: false, goldOnThreeDays: false })
    })

    test('integrations: WhatsApp phone, Gmail per project or account, calendar', () => {
        expect(getConnectedIntegrations({ phone: '+49170' })).toMatchObject({ whatsapp: true, any: true })
        expect(getConnectedIntegrations({ emailConnections: { a: {} } })).toMatchObject({ gmail: true })
        expect(getConnectedIntegrations({ apisConnected: { p: { email: true } } })).toMatchObject({ gmail: true })
        expect(getConnectedIntegrations({ apisConnected: null })).toMatchObject({ any: false })
    })

    test('a cohort is summarized in total and per source', () => {
        const summary = summarizeCohort(
            '2026-11-01',
            [
                { source: 'linkedin', activation: { a: true } },
                { source: 'linkedin', activation: { a: false } },
                { source: 'direct', activation: { a: true } },
            ],
            ['a']
        )
        expect(summary).toEqual({
            day: '2026-11-01',
            signups: 3,
            a: 2,
            bySource: { linkedin: { signups: 2, a: 1 }, direct: { signups: 1, a: 1 } },
        })
    })

    test('a breakdown never grows past its cap', () => {
        const counts = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`s${i}`, i + 1]))
        const capped = capBreakdown(counts)
        expect(Object.keys(capped)).toHaveLength(MAX_BREAKDOWN_KEYS)
        expect(Object.values(capped).reduce((sum, value) => sum + value, 0)).toBe(
            Object.values(counts).reduce((a, b) => a + b, 0)
        )
        expect(DAY_MS).toBe(86400000)
    })
})

describe('growth margin distribution', () => {
    test('percentiles interpolate and an empty list has none', () => {
        expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5)
        expect(percentile([], 0.5)).toBe(null)
    })

    test('counts, sums and medians per plan, account age and source, never per user', () => {
        const summary = summarizeMargins(
            [
                { revenueEur: 30, costEur: 5, plan: 'stripe', tenureDays: 200, source: 'linkedin' },
                { revenueEur: 10, costEur: 25, plan: 'stripe', tenureDays: 10, source: 'unknown' },
                { revenueEur: 0, costEur: 2, plan: 'none', tenureDays: NaN, source: 'direct' },
                { revenueEur: NaN, costEur: 1, plan: 'apple' },
            ],
            { windowDays: 90 }
        )
        expect(summary).toMatchObject({
            windowDays: 90,
            payingUsers: 3,
            profitableUsers: 1,
            marginEur: 8,
            medianMarginEur: -2,
        })
        expect(summary.byPlan.stripe).toMatchObject({ payingUsers: 2, marginEur: 10 })
        expect(Object.keys(summary.byTenure).sort()).toEqual(['90_days_or_more', 'under_30_days', 'unknown'])
        expect(summary.bySignupSource.linkedin.profitableUsers).toBe(1)
    })
})

describe('growth traffic (Google Analytics)', () => {
    test('the REST client sends its own bearer token and pages through the account summaries', async () => {
        const calls = []
        const fetchImpl = jest.fn(async (url, init) => {
            calls.push({ url, init })
            if (url.includes('accountSummaries') && !url.includes('pageToken')) {
                return {
                    ok: true,
                    json: async () => ({
                        accountSummaries: [{ propertySummaries: [{ property: 'properties/1', displayName: 'Web' }] }],
                        nextPageToken: 'next',
                    }),
                }
            }
            if (url.includes('accountSummaries')) {
                return {
                    ok: true,
                    json: async () => ({ accountSummaries: [{ propertySummaries: [{ property: 'properties/2' }] }] }),
                }
            }
            return {
                ok: false,
                status: 403,
                json: async () => ({ error: { message: 'User does not have sufficient permissions' } }),
            }
        })
        const client = createAnalyticsClient({ auth: { getAccessToken: async () => 'token-1' }, fetchImpl })

        expect(await client.listProperties()).toEqual([
            { property: 'properties/1', displayName: 'Web' },
            { property: 'properties/2', displayName: 'properties/2' },
        ])
        expect(calls[0].init.headers.Authorization).toBe('Bearer token-1')
        expect(calls[1].url).toContain('pageToken=next')
        await expect(client.runReport('properties/1', {})).rejects.toThrow('sufficient permissions')
        expect(calls[2].url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/1:runReport')
        expect(calls[2].init.method).toBe('POST')
        await expect(client.runReport('properties/1/../x', {})).rejects.toThrow('Not a GA4 property')
        const noToken = createAnalyticsClient({ auth: { getAccessToken: async () => null }, fetchImpl })
        await expect(noToken.listProperties()).rejects.toThrow('No access token')
    })

    test('summarizes a property report by host, source / medium and campaign', () => {
        const row = (host, source, medium, campaign, sessions, users, newUsers) => ({
            dimensionValues: [host, source, medium, campaign].map(value => ({ value })),
            metricValues: [sessions, users, newUsers].map(value => ({ value: String(value) })),
        })
        const summary = summarizePropertyReports(
            {
                rows: [
                    row('my.alldone.app', 'linkedin', 'social', 'segment-a', 10, 8, 5),
                    row('alldone.app', 'google', 'organic', '(organic)', 20, 18, 12),
                    row('alldone.app', '(direct)', '(none)', '(direct)', 5, 5, 1),
                ],
                rowCount: 3,
            },
            { rows: [{ dimensionValues: [{ value: 'sign_up' }], metricValues: [{ value: '2' }] }] }
        )
        expect(summary).toMatchObject({ sessions: 35, users: 31, newUsers: 18, signupEvents: 2, truncated: false })
        expect(summary.byHost).toEqual({ 'alldone.app': 25, 'my.alldone.app': 10 })
        expect(summary.bySourceMedium['linkedin / social']).toBe(10)
        expect(summary.byCampaign).toEqual({ 'segment-a': 10 })
    })

    test('says what is missing instead of failing when GA cannot be read', async () => {
        const failing = { listProperties: async () => Promise.reject(new Error('API not enabled')) }
        const result = await readTraffic({ day: '2026-11-08', signups: 3, client: failing })
        expect(result.connected).toBe(false)
        expect(result.reason).toMatch(/API not enabled/)
        const none = await readTraffic({ day: '2026-11-08', signups: 3, client: { listProperties: async () => [] } })
        expect(none).toMatchObject({ connected: false })
        expect(none.reason).toMatch(/Viewer role/)
    })

    test('reports every readable property and the share of real signups GA saw', async () => {
        const runReport = jest.fn(async (property, body) =>
            body.dimensions[0].name === 'eventName'
                ? { rows: [{ dimensionValues: [{ value: 'sign_up' }], metricValues: [{ value: '1' }] }] }
                : {
                      rows: [
                          {
                              dimensionValues: [
                                  { value: 'alldone.app' },
                                  { value: 'google' },
                                  { value: 'organic' },
                                  { value: '(organic)' },
                              ],
                              metricValues: [{ value: '40' }, { value: '30' }, { value: '20' }],
                          },
                      ],
                  }
        )
        const client = {
            listProperties: async () => [
                { property: 'properties/1', displayName: 'Website' },
                { property: 'properties/2', displayName: 'App' },
            ],
            runReport,
        }
        const result = await readTraffic({ day: '2026-11-08', signups: 4, client })
        expect(result).toMatchObject({ connected: true, sessions: 80, signupEvents: 2, visibleShare: 0.5 })
        expect(result.properties.map(property => property.name)).toEqual(['website', 'app'])
        expect(runReport.mock.calls[0][1].dateRanges).toEqual([{ startDate: '2026-11-08', endDate: '2026-11-08' }])
        expect((await readTraffic({ day: '2026-11-08', signups: 0, client })).visibleShare).toBe(null)
    })
})
