'use strict'

// Full-text search over project wiki pages, on two surfaces that answer to the same visibility rule
// (isKnowledgePageVisible: not archived, not waiting for a rebuild):
//
//   1. Assistants and MCP clients (`search_knowledge`, knowledgeBaseAssistant.js). The pages of the
//      target project are read FRESH from Firestore and scored here, so a page hidden a second ago
//      by a privacy withdrawal is never returned and its passages never quoted, whatever any index
//      says. A wiki holds at most 150 pages, so a scan is a bounded read. Searching every project of
//      the member asks Typesense which projects have candidate pages and then scans only those, again
//      from Firestore; without Typesense it scans the member's wikis up to a bound.
//   2. Global search in the app, through a Typesense collection of its own (`dev_wiki`), searched
//      with the member's scoped key like every other collection. A page is a record with
//      `isPublicFor: ['0']` because its audience is exactly the project's members, which is what the
//      scoped key's `projectId` filter already enforces. The record carries the page text for
//      matching; the scoped key never returns it (exclude_fields), so a hit shows title and summary.
//      Records follow the page document through onKnowledgePageWritten, and a privacy withdrawal also
//      removes them directly (knowledgeSourceInvalidation.js) rather than waiting for that trigger.

const {
    getKnowledgeBasePath,
    getKnowledgePagesPath,
    isKnowledgePageVisible,
    KNOWLEDGE_BASE_MAX_PAGES,
} = require('./knowledgeBaseModel')

const WIKI_SEARCH_COLLECTION = 'dev_wiki'
const MAX_QUERY_CHARS = 200
const DEFAULT_RESULTS = 6
const MAX_RESULTS = 15
const PASSAGES_PER_PAGE = 3
const PASSAGE_MAX_CHARS = 360
// Without Typesense, a search across all projects reads at most this many wikis.
const MAX_FALLBACK_PROJECTS = 12
const MAX_TYPESENSE_CANDIDATE_PROJECTS = 12
const SEARCH_INDEX_CONTENT_MAX_CHARS = 20000

// Words that say nothing about which page is meant, in the app's languages.
const STOP_WORDS = new Set(
    (
        'a an and are as at be by for from has have how in is it of on or that the this to was what when where which who why with ' +
        'der die das den dem des ein eine einer einem eines und oder ist sind war wie was wer wo wann warum mit von zu im in am an auf für über bei nicht ' +
        'el la los las un una unos unas y o es son era como que quien donde cuando por para con de del en al'
    )
        .split(' ')
        // Compared with folded query words, so folded themselves ("für" is "fur").
        .map(word => word.normalize('NFKD').replace(/[̀-ͯ]/g, ''))
)

const KNOWLEDGE_TOKEN = /\[\[([^[\]\n|]{1,200})(?:\|([^[\]\n]{1,200}))?\]\]/g
const SOURCE_TOKEN = /^(task|goal|note|contact|chat|artifact|correction|document|contribution):/

// Lowercase, accents folded, ß as ss: "Übersicht" and "ubersicht" are the same word to a searcher.
function foldText(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseSearchQuery(query) {
    const folded = foldText(String(query || '').slice(0, MAX_QUERY_CHARS))
    const words = [...new Set(folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean))]
    const meaningful = words.filter(word => word.length > 1 && !STOP_WORDS.has(word))
    const terms = (meaningful.length ? meaningful : words.filter(word => word.length > 1)).slice(0, 12)
    return {
        terms,
        phrase: terms.length > 1 ? folded.replace(/\s+/g, ' ').trim() : '',
        matchers: terms.map(term => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, 'gu')),
    }
}

function countMatches(matcher, foldedText) {
    matcher.lastIndex = 0
    let count = 0
    while (matcher.exec(foldedText) && count < 50) count += 1
    return count
}

// The page text a reader sees: link and source tokens become their labels, a bare source token
// disappears (it only cites), a bare page link stays as its slug.
function toPlainWikiText(markdown) {
    return String(markdown || '').replace(KNOWLEDGE_TOKEN, (whole, inner, label) => {
        if (label) return label.trim()
        const trimmed = inner.trim()
        return SOURCE_TOKEN.test(trimmed) ? '' : trimmed
    })
}

// Paragraphs and list items, each with the heading it sits under.
function splitIntoBlocks(markdown) {
    const blocks = []
    let heading = ''
    let current = []
    const flush = () => {
        const text = current.join(' ').replace(/\s+/g, ' ').trim()
        if (text) blocks.push({ heading, text })
        current = []
    }
    for (const line of String(markdown || '').split('\n')) {
        const headingMatch = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line)
        if (headingMatch) {
            flush()
            heading = toPlainWikiText(headingMatch[1]).trim()
            continue
        }
        if (!line.trim()) {
            flush()
            continue
        }
        if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) flush()
        current.push(toPlainWikiText(line.replace(/^\s*([-*+]|\d+[.)])\s+/, '')))
    }
    flush()
    return blocks
}

// A passage around the first match, cut at word boundaries.
function clipAroundMatch(text, query) {
    if (text.length <= PASSAGE_MAX_CHARS) return text
    const folded = foldText(text)
    let first = folded.length
    for (const matcher of query.matchers) {
        matcher.lastIndex = 0
        const match = matcher.exec(folded)
        if (match) first = Math.min(first, match.index + match[1].length)
    }
    if (first === folded.length) first = 0
    let start = Math.max(0, first - Math.floor(PASSAGE_MAX_CHARS / 3))
    let end = Math.min(text.length, start + PASSAGE_MAX_CHARS)
    start = Math.max(0, end - PASSAGE_MAX_CHARS)
    if (start > 0) start = text.indexOf(' ', start) + 1 || start
    if (end < text.length) end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function findPassages(page, query) {
    return splitIntoBlocks(page.body)
        .map((block, index) => {
            const folded = foldText(block.text)
            const counts = query.matchers.map(matcher => countMatches(matcher, folded))
            const distinct = counts.filter(Boolean).length
            const headingHits = query.matchers.filter(matcher => countMatches(matcher, foldText(block.heading))).length
            return { ...block, index, distinct, score: distinct * 10 + counts.reduce((a, b) => a + b, 0) + headingHits }
        })
        .filter(block => block.distinct > 0 || block.score > 0)
        .sort((left, right) => right.distinct - left.distinct || right.score - left.score || left.index - right.index)
        .slice(0, PASSAGES_PER_PAGE)
        .sort((left, right) => left.index - right.index)
        .map(block => ({
            ...(block.heading ? { heading: block.heading } : {}),
            text: clipAroundMatch(block.text, query),
        }))
}

/**
 * Scores one visible page against a parsed query; null when it does not match enough of the query.
 * A page must match at least half of the terms (all of them for two or fewer), so a long question
 * still finds the page that answers most of it while a stray common word finds nothing.
 */
function scoreKnowledgePage(page, query) {
    if (!query.terms.length) return null
    const title = foldText(page.title || page.slug)
    const summary = foldText(page.summary)
    const body = foldText(toPlainWikiText(page.body))
    let score = 0
    let matchedTerms = 0
    query.matchers.forEach(matcher => {
        const inTitle = countMatches(matcher, title)
        const inSummary = countMatches(matcher, summary)
        const inBody = countMatches(matcher, body)
        if (inTitle || inSummary || inBody) matchedTerms += 1
        score += (inTitle ? 8 : 0) + (inSummary ? 4 : 0) + Math.min(inBody, 6)
    })
    const required = query.terms.length <= 2 ? query.terms.length : Math.ceil(query.terms.length / 2)
    if (matchedTerms < required) return null
    if (query.phrase && (title.includes(query.phrase) || body.includes(query.phrase))) score += 10
    return { score: score + matchedTerms * 20, matchedTerms }
}

function toIso(value) {
    const millis = Number(value)
    return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : null
}

async function loadVisiblePages(db, projectId) {
    const snapshot = await db
        .collection(getKnowledgePagesPath(projectId))
        .select('title', 'summary', 'body', 'archived', 'needsRebuild', 'updatedAt', 'revision')
        .limit(KNOWLEDGE_BASE_MAX_PAGES * 2)
        .get()
    return snapshot.docs.map(doc => ({ ...(doc.data() || {}), slug: doc.id })).filter(isKnowledgePageVisible)
}

function searchPages(pages, query, projectId, projectName) {
    return pages
        .map(page => ({ page, match: scoreKnowledgePage(page, query) }))
        .filter(({ match }) => match)
        .map(({ page, match }) => ({
            projectId,
            ...(projectName ? { projectName } : {}),
            slug: page.slug,
            title: page.title || page.slug,
            summary: page.summary || '',
            revision: Number(page.revision) || 0,
            updatedAt: toIso(page.updatedAt),
            passages: findPassages(page, query),
            score: match.score,
            matchedTerms: match.matchedTerms,
        }))
}

function rank(results) {
    return results.sort(
        (left, right) =>
            right.matchedTerms - left.matchedTerms ||
            right.score - left.score ||
            String(left.title).localeCompare(String(right.title))
    )
}

async function loadMemberProjects(db, userId) {
    const snapshot = await db.collection('projects').where('userIds', 'array-contains', userId).select('name').get()
    return snapshot.docs.map(doc => ({ id: doc.id, name: (doc.data() || {}).name || doc.id }))
}

// Which of the member's projects have pages matching the query, by the search index. Only a hint for
// what to scan: what is returned is read fresh from Firestore.
async function findCandidateProjectsInIndex({ typesense, query, projectIds }) {
    if (!typesense?.isTypesenseConfigured?.() || !projectIds.length) return null
    const filter = `projectId:=[${projectIds.map(typesense.formatTypesenseFilterValue).join(',')}]`
    const { hits } = await typesense.searchTypesenseDocuments(WIKI_SEARCH_COLLECTION, query, {
        filterBy: filter,
        perPage: 50,
    })
    const ordered = []
    hits.forEach(hit => {
        if (hit.projectId && !ordered.includes(hit.projectId)) ordered.push(hit.projectId)
    })
    return ordered.slice(0, MAX_TYPESENSE_CANDIDATE_PROJECTS)
}

async function filterProjectsWithWiki(db, projects) {
    if (!projects.length) return []
    const snapshots = await db.getAll(...projects.map(project => db.doc(getKnowledgeBasePath(project.id))))
    return projects.filter((project, index) => snapshots[index].exists)
}

/**
 * The search_knowledge tool. `projectIds` are projects the caller is a member of (checked by the
 * caller); with `allProjects` the member's projects are found here.
 */
async function searchKnowledgeBase({
    db,
    userId,
    projectId,
    query: rawQuery,
    allProjects = false,
    limit = DEFAULT_RESULTS,
    loadTypesense = () => require('../typesenseHelper'),
}) {
    const queryText = String(rawQuery || '').trim()
    const query = parseSearchQuery(queryText)
    if (!query.terms.length) return { success: false, error: 'search_knowledge needs a query with at least one word.' }
    const max = Math.min(MAX_RESULTS, Math.max(1, Math.floor(Number(limit)) || DEFAULT_RESULTS))

    let projects
    let scope = 'project'
    let scannedAllCandidates = true
    if (allProjects) {
        scope = 'all_projects'
        const memberProjects = await loadMemberProjects(db, userId)
        let candidateIds = null
        try {
            candidateIds = await findCandidateProjectsInIndex({
                typesense: loadTypesense(),
                query: queryText,
                projectIds: memberProjects.map(project => project.id),
            })
        } catch (error) {
            console.warn('[knowledge base] Wiki search index unavailable; scanning wikis directly', {
                error: error.message,
            })
        }
        if (candidateIds) {
            projects = candidateIds.map(id => memberProjects.find(project => project.id === id)).filter(Boolean)
        } else {
            const withWiki = await filterProjectsWithWiki(db, memberProjects)
            scannedAllCandidates = withWiki.length <= MAX_FALLBACK_PROJECTS
            projects = withWiki.slice(0, MAX_FALLBACK_PROJECTS)
        }
    } else {
        const snapshot = await db.doc(`projects/${projectId}`).get()
        projects = [{ id: projectId, name: (snapshot.exists && snapshot.data()?.name) || projectId }]
    }

    const results = []
    for (const project of projects) {
        const pages = await loadVisiblePages(db, project.id)
        results.push(...searchPages(pages, query, project.id, scope === 'all_projects' ? project.name : null))
    }
    const ranked = rank(results).slice(0, max)
    return {
        success: true,
        query: queryText,
        scope,
        ...(scope === 'project' ? { projectId } : { projectsSearched: projects.length }),
        ...(scannedAllCandidates ? {} : { incomplete: true }),
        results: ranked.map(({ score, matchedTerms, ...result }) => result),
        note: ranked.length
            ? 'Passages are quoted from the current pages. Read a page with read_knowledge_page (same projectId and slug) before relying on details; name pages by their title.'
            : 'No wiki page matches. Try other words, or fall back to the original tasks, notes and chats.',
    }
}

// ---- Global search index (Typesense) ----

function toMillis(value) {
    const millis = Number(value)
    return Number.isFinite(millis) && millis > 0 ? Math.round(millis) : undefined
}

function buildKnowledgePageSearchRecord({ projectId, slug, page }) {
    return {
        objectID: `${slug}${projectId}`,
        projectId,
        slug,
        title: String(page.title || slug),
        summary: String(page.summary || ''),
        content: toPlainWikiText(page.body).replace(/\s+/g, ' ').trim().slice(0, SEARCH_INDEX_CONTENT_MAX_CHARS),
        // The project's members: the scoped key's projectId filter is the whole access rule.
        isPublicFor: ['0'],
        revision: Number(page.revision) || 0,
        lastEditionDate: toMillis(page.updatedAt),
        created: toMillis(page.createdAt),
    }
}

const INDEXED_PAGE_FIELDS = ['title', 'summary', 'body', 'archived', 'needsRebuild', 'revision']

function knowledgePageSearchUpdateNeeded(before, after) {
    if (!before || !after) return true
    return INDEXED_PAGE_FIELDS.some(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
}

async function removeKnowledgePageFromSearch({ projectId, slug, typesense = require('../typesenseHelper') }) {
    if (!typesense.isTypesenseConfigured()) return
    await typesense.deleteTypesenseDocument(WIKI_SEARCH_COLLECTION, `${slug}${projectId}`)
}

async function removeKnowledgePagesFromSearch({ projectId, slugs, typesense = require('../typesenseHelper') }) {
    await Promise.all(
        [...new Set(slugs || [])].map(slug =>
            removeKnowledgePageFromSearch({ projectId, slug, typesense }).catch(error =>
                console.warn('[knowledge base] Could not remove a wiki page from search', {
                    projectId,
                    slug,
                    error: error.message,
                })
            )
        )
    )
}

/**
 * Keeps the search record of one page in step with its document. A page that may not be shown
 * (archived, waiting for a rebuild, deleted) has no record.
 */
async function onKnowledgePageWritten({ projectId, slug, before, after, typesense = require('../typesenseHelper') }) {
    if (!typesense.isTypesenseConfigured()) return { action: 'skipped' }
    if (!isKnowledgePageVisible(after)) {
        if (before && !isKnowledgePageVisible(before)) return { action: 'unchanged' }
        await removeKnowledgePageFromSearch({ projectId, slug, typesense })
        return { action: 'removed' }
    }
    if (isKnowledgePageVisible(before) && !knowledgePageSearchUpdateNeeded(before, after)) {
        return { action: 'unchanged' }
    }
    await typesense.upsertTypesenseDocument(
        WIKI_SEARCH_COLLECTION,
        buildKnowledgePageSearchRecord({ projectId, slug, page: after })
    )
    return { action: 'indexed' }
}

// The backfill (migration/backfillTypesense.js --types=wiki): every visible page of one project.
async function buildProjectKnowledgeSearchRecords({ projectId, db }) {
    const snapshot = await db.collection(getKnowledgePagesPath(projectId)).get()
    return snapshot.docs
        .map(doc => ({ slug: doc.id, page: doc.data() || {} }))
        .filter(({ page }) => isKnowledgePageVisible(page))
        .map(({ slug, page }) => buildKnowledgePageSearchRecord({ projectId, slug, page }))
}

module.exports = {
    WIKI_SEARCH_COLLECTION,
    MAX_RESULTS,
    foldText,
    parseSearchQuery,
    toPlainWikiText,
    splitIntoBlocks,
    findPassages,
    scoreKnowledgePage,
    searchKnowledgeBase,
    buildKnowledgePageSearchRecord,
    knowledgePageSearchUpdateNeeded,
    onKnowledgePageWritten,
    removeKnowledgePagesFromSearch,
    buildProjectKnowledgeSearchRecords,
}
