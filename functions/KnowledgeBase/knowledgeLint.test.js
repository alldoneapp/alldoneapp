const {
    LINT_BUDGET_RESERVE_SHARE,
    LLM_LINT_INTERVAL_MS,
    PROTECTED_AFTER_CORRECTION_MS,
    buildKnowledgeLintReport,
    buildLintTask,
    getLintSpendLimit,
    getProtectedSlugs,
    isLlmLintDue,
    selectLintBatches,
    withLintReason,
} = require('./knowledgeLint')

const NOW = Date.UTC(2026, 9, 28, 8)
const page = (slug, data = {}) => ({
    slug,
    title: slug,
    body: `About ${slug}.`,
    archived: false,
    needsRebuild: false,
    revision: 1,
    updatedAt: NOW - 1000,
    ...data,
})

describe('rule-based checks', () => {
    it('finds long pages, broken links, orphans, duplicate titles and uncited sources', () => {
        const pages = new Map(
            [
                page('hub', { body: 'See [[pricing]], [[team]] and [[gone]].' }),
                page('pricing', {
                    title: 'Pricing',
                    body: `${'word '.repeat(1600)} [[task:t1]]`,
                    sourceKeys: ['task:t1', 'task:t2', 'note:n1'],
                }),
                page('team', { title: 'Team', body: 'Links back to [[hub]] and [[rebuilding]].' }),
                page('pricing-2', { title: 'pricing' }),
                page('rebuilding', { needsRebuild: true, body: undefined }),
                page('old', { archived: true }),
            ].map(p => [p.slug, p])
        )

        const report = buildKnowledgeLintReport(pages, { now: NOW })

        expect(report.pageCount).toBe(4)
        expect(report.issues).toEqual(
            expect.arrayContaining([
                { type: 'oversized', slug: 'pricing', words: 1601, chars: expect.any(Number) },
                // A link to a page waiting for a rebuild is not broken; one to an archived or missing page is.
                { type: 'broken_link', slug: 'hub', targets: ['gone'] },
                { type: 'uncited_sources', slug: 'pricing', listed: 3, cited: 1 },
                { type: 'orphan', slug: 'pricing-2' },
                { type: 'duplicate_title', slug: 'pricing', others: ['pricing-2'] },
            ])
        )
        expect(report.issues).not.toContainEqual(expect.objectContaining({ type: 'orphan', slug: 'hub' }))
        expect(report.issues).not.toContainEqual(expect.objectContaining({ slug: 'rebuilding' }))
        expect(report.counts).toEqual({
            oversized: 1,
            broken_link: 1,
            orphan: 1,
            duplicate_title: 1,
            uncited_sources: 1,
        })
    })

    it('does not call two pages orphans, and bounds what it reports', () => {
        const two = buildKnowledgeLintReport([page('a'), page('b')], { now: NOW })
        expect(two.counts.orphan).toBe(0)
        const many = buildKnowledgeLintReport(
            Array.from({ length: 80 }, (_, index) => page(`p${index}`)),
            { now: NOW }
        )
        expect(many.issues).toHaveLength(60)
        expect(many.truncated).toBe(true)
        expect(many.counts.orphan).toBe(80)
    })
})

describe('when the model pass runs and what it may touch', () => {
    const pages = [page('a', { updatedAt: NOW - 1000 }), page('b', { updatedAt: NOW - 10 * 24 * 3600 * 1000 })]

    it('runs at most once a week, only when a page changed since, and only on a wiki with pages', () => {
        expect(isLlmLintDue({}, pages, NOW)).toBe(true)
        expect(isLlmLintDue({ lastLlmLintAt: NOW - LLM_LINT_INTERVAL_MS + 1 }, pages, NOW)).toBe(false)
        expect(isLlmLintDue({ lastLlmLintAt: NOW - LLM_LINT_INTERVAL_MS }, pages, NOW)).toBe(true)
        // A week passed but nothing changed: nothing to look at again.
        expect(
            isLlmLintDue(
                { lastLlmLintAt: NOW - LLM_LINT_INTERVAL_MS },
                [page('a', { updatedAt: 1 }), page('b', { updatedAt: 1 })],
                NOW
            )
        ).toBe(false)
        expect(isLlmLintDue({}, [page('a')], NOW)).toBe(false)
    })

    it('leaves the last fifth of the monthly cap to the ingest', () => {
        expect(LINT_BUDGET_RESERVE_SHARE).toBe(0.2)
        expect(getLintSpendLimit(500)).toBe(400)
    })

    it('protects pages a member corrected in the last two weeks', () => {
        const corrections = [
            { id: 'k1', data: { pageSlug: 'a', createdAt: NOW - 1000 } },
            { id: 'k2', data: { pageSlug: 'b', createdAt: NOW - PROTECTED_AFTER_CORRECTION_MS - 1 } },
        ]
        expect([...getProtectedSlugs(corrections, NOW)]).toEqual(['a'])
    })

    it('puts flagged pages first and packs batches up to a budget', () => {
        const report = { issues: [{ type: 'orphan', slug: 'b' }] }
        const batches = selectLintBatches(
            [page('a'), page('b', { updatedAt: 1 }), page('c', { body: 'x'.repeat(40000) })],
            report,
            { maxTokens: 5000 }
        )
        expect(batches.map(batch => batch.map(p => p.slug))).toEqual([['b', 'a']])
    })

    it('tells the model not to settle a contradiction by recency and to keep open questions', () => {
        const task = buildLintTask({
            now: NOW,
            report: { issues: [{ type: 'broken_link', slug: 'a', targets: ['x'] }] },
            protectedSlugs: new Set(['a']),
            batch: [page('a'), page('b')],
        })
        expect(task).toContain('today is 2026-10-28')
        expect(task).toContain('Never decide a contradiction by which page or statement looks newer')
        expect(task).toContain('"Open questions"')
        expect(task).toContain('must not be changed: [[a]]')
        expect(task).toContain('[[a]] links to pages that do not exist: x.')
        expect(withLintReason('linked pages')).toBe('lint: linked pages')
        expect(withLintReason('Lint:  merged duplicates')).toBe('lint: merged duplicates')
        expect(withLintReason('')).toBe('lint: health check')
    })
})
