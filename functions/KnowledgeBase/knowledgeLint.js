'use strict'

// The wiki's health check ("lint", after Karpathy's LLM-wiki notes), in two parts that run inside an
// ingest run (knowledgeBaseIngest.js) after everything new has been folded in:
//
//   1. Rule-based checks, on every run that changed something or has no report yet. They read only
//      the pages already loaded, cost nothing and write one compact report on the wiki document
//      (`lintReport`): pages too long to read well, links to pages that do not exist, pages nothing
//      links to, duplicate titles, and sources a page lists but no longer cites. The last one is a
//      count, never a fix: a page's `sourceKeys` is the provenance the privacy withdrawal relies on
//      (knowledgeSourceInvalidation.js) and only ever grows outside a rebuild.
//   2. A model pass, at most once a week (LLM_LINT_INTERVAL_MS) and only when a page changed since
//      the last one, on a bounded batch of pages: contradictions between pages, statements that are
//      out of date by the calendar, subjects that deserve a page of their own, missing links, plus
//      whatever the rule-based checks found. It has the ingest's tools and the store's guards,
//      with three more: it may not touch a page a member corrected in the last
//      PROTECTED_AFTER_CORRECTION_MS, it may change at most MAX_LINT_EDITS pages, and every change
//      carries a reason beginning with "lint:" in the page history. It only spends while the month
//      has used less than (1 - LINT_BUDGET_RESERVE_SHARE) of the wiki's Gold cap, so the last part of
//      the cap always stays for the ingest itself.
//
// A model that sees only pages cannot know which of two disagreeing statements is true, and a later
// date is not proof (WIKI_RULES' "a later card wins" holds for SOURCE cards, not for pages). So the
// pass never resolves a contradiction on recency alone: it records it as an open question on the
// pages concerned, citing both sides, unless one side is a member's correction.

const {
    KNOWLEDGE_PAGE_MAX_CHARS,
    estimateTextTokens,
    extractKnowledgeTokens,
    isKnowledgePageVisible,
    normalizeKnowledgePageSlug,
    splitKnowledgePageSources,
} = require('./knowledgeBaseModel')

const DAY_MS = 24 * 60 * 60 * 1000
const LLM_LINT_INTERVAL_MS = 7 * DAY_MS
const PROTECTED_AFTER_CORRECTION_MS = 14 * DAY_MS
const LINT_BUDGET_RESERVE_SHARE = 0.2
const MAX_LINT_EDITS = 10
const MAX_LINT_CONVERSATIONS = 3
const LINT_BATCH_MAX_TOKENS = 14000
const MIN_PAGES_FOR_LLM_LINT = 2
// WIKI_RULES asks for a split above about 1500 words.
const OVERSIZE_WORDS = 1500
const OVERSIZE_CHARS = Math.floor(KNOWLEDGE_PAGE_MAX_CHARS * 0.9)
const MIN_PAGES_FOR_ORPHAN_CHECK = 3
const MAX_REPORTED_ISSUES = 60
const LINT_REASON_PREFIX = 'lint: '

const LINT_ISSUE_TYPES = ['oversized', 'broken_link', 'orphan', 'duplicate_title', 'uncited_sources']

function countWords(text) {
    return String(text || '')
        .split(/\s+/)
        .filter(Boolean).length
}

function normalizeTitle(title) {
    return normalizeKnowledgePageSlug(title)
}

/**
 * The rule-based checks over all pages of a wiki (a Map or array of pages with `slug`). Pages
 * waiting for a rebuild still exist for the link check (a link to them is not broken) but are not
 * checked themselves: their text was withdrawn.
 */
function buildKnowledgeLintReport(pages, { now = Date.now() } = {}) {
    const all = [...(pages instanceof Map ? pages.values() : pages || [])].filter(page => page && page.slug)
    const visible = all.filter(isKnowledgePageVisible)
    const existing = new Set(all.filter(page => page.archived !== true).map(page => page.slug))
    const issues = []
    const incoming = new Map(visible.map(page => [page.slug, 0]))

    for (const page of visible) {
        const words = countWords(page.body)
        const chars = String(page.body || '').length
        if (words > OVERSIZE_WORDS || chars > OVERSIZE_CHARS) {
            issues.push({ type: 'oversized', slug: page.slug, words, chars })
        }
        const links = extractKnowledgeTokens(page.body).pageLinks.filter(link => link !== page.slug)
        const broken = links.filter(link => !existing.has(link))
        if (broken.length) issues.push({ type: 'broken_link', slug: page.slug, targets: broken.slice(0, 10) })
        links.forEach(link => incoming.has(link) && incoming.set(link, incoming.get(link) + 1))
        const { otherSourceKeys, citedSourceKeys } = splitKnowledgePageSources(page)
        if (otherSourceKeys.length) {
            issues.push({
                type: 'uncited_sources',
                slug: page.slug,
                listed: citedSourceKeys.length + otherSourceKeys.length,
                cited: citedSourceKeys.length,
            })
        }
    }

    if (visible.length >= MIN_PAGES_FOR_ORPHAN_CHECK) {
        visible.forEach(page => {
            if (!incoming.get(page.slug)) issues.push({ type: 'orphan', slug: page.slug })
        })
    }

    const byTitle = new Map()
    visible.forEach(page => {
        const key = normalizeTitle(page.title || page.slug)
        if (!key) return
        byTitle.set(key, [...(byTitle.get(key) || []), page.slug])
    })
    byTitle.forEach(slugs => {
        if (slugs.length > 1) issues.push({ type: 'duplicate_title', slug: slugs[0], others: slugs.slice(1) })
    })

    const counts = Object.fromEntries(LINT_ISSUE_TYPES.map(type => [type, 0]))
    issues.forEach(issue => (counts[issue.type] += 1))
    return {
        checkedAt: now,
        pageCount: visible.length,
        counts,
        issues: issues.slice(0, MAX_REPORTED_ISSUES),
        truncated: issues.length > MAX_REPORTED_ISSUES,
    }
}

function latestPageChange(pages) {
    let latest = 0
    for (const page of pages instanceof Map ? pages.values() : pages || []) {
        if (isKnowledgePageVisible(page)) latest = Math.max(latest, Number(page.updatedAt) || 0)
    }
    return latest
}

/** Whether the weekly model pass is due: a week since the last one, and a page changed since. */
function isLlmLintDue(lintState = {}, pages, now = Date.now()) {
    const visibleCount = [...(pages instanceof Map ? pages.values() : pages || [])].filter(
        isKnowledgePageVisible
    ).length
    if (visibleCount < MIN_PAGES_FOR_LLM_LINT) return false
    const last = Number(lintState?.lastLlmLintAt) || 0
    if (last && now - last < LLM_LINT_INTERVAL_MS) return false
    return !last || latestPageChange(pages) > last
}

/** The highest monthly spending at which the lint pass may still start a model round. */
function getLintSpendLimit(goldCap) {
    return Math.floor(goldCap * (1 - LINT_BUDGET_RESERVE_SHARE))
}

/** Pages a member corrected recently: the lint pass leaves them alone. */
function getProtectedSlugs(corrections, now = Date.now()) {
    const slugs = new Set()
    ;(corrections || []).forEach(({ data }) => {
        if (data?.pageSlug && Number(data.createdAt) > now - PROTECTED_AFTER_CORRECTION_MS) slugs.add(data.pageSlug)
    })
    return slugs
}

function describeIssue(issue) {
    switch (issue.type) {
        case 'oversized':
            return `[[${issue.slug}]] is long (${issue.words} words); consider splitting it into linked pages.`
        case 'broken_link':
            return `[[${issue.slug}]] links to pages that do not exist: ${issue.targets.join(', ')}.`
        case 'orphan':
            return `No page links to [[${issue.slug}]].`
        case 'duplicate_title':
            return `[[${issue.slug}]] has the same title as ${issue.others.map(slug => `[[${slug}]]`).join(', ')}.`
        default:
            return null
    }
}

/**
 * The batches of pages the model pass looks at: pages with rule-based findings first, then the most
 * recently changed ones, packed up to a token budget so that pages which may contradict each other
 * are read side by side. Protected pages are shown (they can still be the reference for others)
 * but marked read-only.
 */
function selectLintBatches(
    pages,
    report,
    { maxTokens = LINT_BATCH_MAX_TOKENS, maxBatches = MAX_LINT_CONVERSATIONS } = {}
) {
    const visible = [...(pages instanceof Map ? pages.values() : pages || [])].filter(isKnowledgePageVisible)
    const flagged = new Set((report?.issues || []).filter(issue => issue.type !== 'uncited_sources').map(i => i.slug))
    const ordered = visible.sort(
        (left, right) =>
            Number(flagged.has(right.slug)) - Number(flagged.has(left.slug)) ||
            (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0) ||
            (left.slug < right.slug ? -1 : 1)
    )
    const batches = []
    let current = []
    let tokens = 0
    for (const page of ordered) {
        const pageTokens = estimateTextTokens(page.body) + 50
        if (current.length && tokens + pageTokens > maxTokens) {
            batches.push(current)
            if (batches.length >= maxBatches) return batches
            current = []
            tokens = 0
        }
        if (pageTokens > maxTokens) continue
        current.push(page)
        tokens += pageTokens
    }
    if (current.length && batches.length < maxBatches) batches.push(current)
    return batches
}

function buildLintTask({ now, report, protectedSlugs, batch }) {
    const slugsInBatch = new Set(batch.map(page => page.slug))
    const findings = (report?.issues || [])
        .filter(issue => slugsInBatch.has(issue.slug))
        .map(describeIssue)
        .filter(Boolean)
    const protectedHere = batch.filter(page => protectedSlugs.has(page.slug)).map(page => `[[${page.slug}]]`)
    return [
        `Health check of the wiki (today is ${new Date(now).toISOString().slice(0, 10)}). The next message holds the current text of some of its pages. Look for, and fix where the pages themselves give enough evidence:`,
        '- statements on different pages that contradict each other;',
        '- statements that are out of date by the calendar (a deadline, plan or "next step" whose date has passed with no outcome recorded);',
        '- a subject several pages mention that deserves a page of its own, and missing [[slug]] links between pages about related subjects;',
        '- the findings of the rule-based check below.',
        'You do not see the sources, only the pages, so you cannot verify a claim. Therefore:',
        '- Never decide a contradiction by which page or statement looks newer. Resolve it only when a member correction ([[correction:ID]]) settles it or one statement is plainly a mistake of wording; otherwise keep both statements with their citations and add the question to a section "Open questions" on the pages concerned.',
        '- A plan whose date has passed is not proof it happened or failed: rephrase it as an open question ("Was … done by …?") instead of deleting it or claiming an outcome.',
        '- Add no fact that is not already on a page, and keep every citation token of a statement you move or keep. A new page may only gather statements from the pages here, with their citations.',
        `- Change at most ${MAX_LINT_EDITS} pages in total, and only where it clearly helps a reader. When nothing needs to change, change nothing.`,
        '- Read a page with read_page before you replace it. Start every reason with "lint:".',
        protectedHere.length
            ? `- These pages were corrected by a member recently and must not be changed: ${protectedHere.join(', ')}.`
            : '',
        findings.length ? `Rule-based findings:\n${findings.map(line => `- ${line}`).join('\n')}` : '',
    ]
        .filter(Boolean)
        .join('\n')
}

function buildLintUserPrompt(batch) {
    return `Pages, most relevant first:\n\n${batch
        .map(
            page =>
                `=== [[${page.slug}]] "${page.title || page.slug}" (revision ${Number(page.revision) || 0})\n${page.body || ''}`
        )
        .join('\n\n')}`
}

/** Every source the pages of a batch already cite or list: what a lint edit may cite. */
function collectBatchSourceKeys(batch) {
    const keys = new Set()
    batch.forEach(page => (Array.isArray(page.sourceKeys) ? page.sourceKeys : []).forEach(key => keys.add(key)))
    return keys
}

/** The labels the pages of a batch already carry, so a statement moved to another page keeps its chip text. */
function collectBatchSourceLabels(batch) {
    const labels = {}
    batch.forEach(page => Object.assign(labels, page.sourceLabels || {}))
    return labels
}

function withLintReason(reason) {
    const text = String(reason || '').trim()
    if (/^lint\s*:/i.test(text)) return `${LINT_REASON_PREFIX}${text.replace(/^lint\s*:\s*/i, '')}`
    return `${LINT_REASON_PREFIX}${text || 'health check'}`
}

module.exports = {
    LLM_LINT_INTERVAL_MS,
    PROTECTED_AFTER_CORRECTION_MS,
    LINT_BUDGET_RESERVE_SHARE,
    MAX_LINT_EDITS,
    MAX_LINT_CONVERSATIONS,
    LINT_REASON_PREFIX,
    LINT_ISSUE_TYPES,
    buildKnowledgeLintReport,
    isLlmLintDue,
    getLintSpendLimit,
    getProtectedSlugs,
    selectLintBatches,
    buildLintTask,
    buildLintUserPrompt,
    collectBatchSourceKeys,
    collectBatchSourceLabels,
    withLintReason,
}
