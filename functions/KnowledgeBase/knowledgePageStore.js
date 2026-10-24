'use strict'

// Reading and writing wiki pages. Every write of a page goes through writeKnowledgePage, whoever
// asked for it (an ingest run, a rebuild, later a correction), so the rules a page must satisfy are
// enforced in one place and never taken on trust from the model:
//
//   - a page cites only sources it may cite: those of the current run, the ones it already had, and
//     corrections. Anything else, including a key the model invented, is removed from the body;
//   - `sourceKeys` records every source the page relies on, because that list is what hides the
//     page when one of them turns private or is deleted (knowledgeSourceInvalidation.js);
//   - a page is only replaced by someone who read its current revision (optimistic concurrency), so a
//     run cannot silently overwrite a correction that landed while it was thinking;
//   - every change leaves a revision with its run and reason: the wiki's history and its undo.

const { FieldValue } = require('firebase-admin/firestore')

const {
    KNOWLEDGE_BASE_MAX_PAGES,
    KNOWLEDGE_PAGE_MAX_CHARS,
    KNOWLEDGE_PAGE_SUMMARY_MAX_CHARS,
    KNOWLEDGE_PAGE_TITLE_MAX_CHARS,
    extractKnowledgeTokens,
    getKnowledgePagePath,
    getKnowledgePageRevisionsPath,
    getKnowledgePagesPath,
    isKnowledgePageVisible,
    isKnowledgeSourceKey,
    normalizeKnowledgePageSlug,
    rewriteKnowledgeSourceTokens,
} = require('./knowledgeBaseModel')

const KNOWLEDGE_INDEX_MAX_CHARS = 12000

function clip(value, maxChars) {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
    return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`
}

function revisionId(revision) {
    return String(revision).padStart(6, '0')
}

async function loadKnowledgePages(db, projectId) {
    const snapshot = await db.collection(getKnowledgePagesPath(projectId)).get()
    const pages = new Map()
    snapshot.docs.forEach(doc => pages.set(doc.id, { ...(doc.data() || {}), slug: doc.id }))
    return pages
}

function countActivePages(pages) {
    let count = 0
    for (const page of pages.values()) if (page.archived !== true) count += 1
    return count
}

/**
 * The index an assistant carries in its prompt: one line per visible page. Pages waiting for a
 * rebuild are left out, since their summary may still repeat what a withdrawn source said.
 */
function buildKnowledgeIndex(pages, { maxChars = KNOWLEDGE_INDEX_MAX_CHARS } = {}) {
    const lines = [...pages.values()]
        .filter(isKnowledgePageVisible)
        .sort((left, right) => String(left.title || left.slug).localeCompare(String(right.title || right.slug)))
        .map(page => `- [[${page.slug}]] ${page.title || page.slug}${page.summary ? ` — ${page.summary}` : ''}`)

    const kept = []
    let length = 0
    for (const line of lines) {
        if (length + line.length + 1 > maxChars) {
            kept.push(`- … and ${lines.length - kept.length} more pages`)
            break
        }
        kept.push(line)
        length += line.length + 1
    }
    return kept.join('\n')
}

function failure(error) {
    return { success: false, error }
}

/**
 * @param {object} args
 * @param {'ingest'|'rebuild'} args.mode  a rebuild replaces the page's sources instead of adding to
 *        them and is the only write allowed on a page waiting for a rebuild
 * @param {Set<string>} args.allowedSourceKeys  sources of the current run (and corrections)
 * @param {number|null} args.expectedRevision  revision the writer read; 0 for a page it creates
 */
async function writeKnowledgePage({
    db,
    projectId,
    slug: requestedSlug,
    title: requestedTitle,
    summary: requestedSummary,
    body: requestedBody,
    sourceKeys: declaredSourceKeys = [],
    allowedSourceKeys = new Set(),
    // Display titles of the run's sources ({ 'task:abc': 'Release planen' }), so the page can label
    // its source chips without one read per chip. Only sources the page keeps are stored.
    sourceLabels: runSourceLabels = {},
    expectedRevision = null,
    mode = 'ingest',
    author = { type: 'ingest' },
    runId = null,
    reason = '',
    now = Date.now(),
    activePageCount = 0,
    fieldValue = FieldValue,
}) {
    const slug = normalizeKnowledgePageSlug(requestedSlug || requestedTitle)
    if (!slug) return failure('A page needs a slug or a title.')
    const title = clip(requestedTitle, KNOWLEDGE_PAGE_TITLE_MAX_CHARS)
    if (!title) return failure('A page needs a title.')
    const summary = clip(requestedSummary, KNOWLEDGE_PAGE_SUMMARY_MAX_CHARS)
    const rawBody = typeof requestedBody === 'string' ? requestedBody.trim() : ''
    if (!rawBody) return failure('A page needs a body. Use archive_page to remove a page.')
    if (rawBody.length > KNOWLEDGE_PAGE_MAX_CHARS) {
        return failure(
            `The page body is ${rawBody.length} characters; the limit is ${KNOWLEDGE_PAGE_MAX_CHARS}. Split it into several pages and link them.`
        )
    }

    const pageRef = db.doc(getKnowledgePagePath(projectId, slug))
    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(pageRef)
        const current = snapshot.exists ? snapshot.data() || {} : null
        const currentRevision = Number(current?.revision) || 0

        if (current && current.archived !== true) {
            if (expectedRevision === null || expectedRevision === undefined) {
                return failure(`The page "${slug}" exists. Read it with read_page before replacing it.`)
            }
            if (Number(expectedRevision) !== currentRevision) {
                return failure(`The page "${slug}" changed since it was read. Read it again before replacing it.`)
            }
        } else if (activePageCount >= KNOWLEDGE_BASE_MAX_PAGES) {
            return failure(
                `The wiki already has ${KNOWLEDGE_BASE_MAX_PAGES} pages. Extend an existing page instead of creating one.`
            )
        }
        if (current?.needsRebuild === true && mode !== 'rebuild') {
            return failure(`The page "${slug}" is being rebuilt and cannot be edited now.`)
        }

        const existingSourceKeys =
            mode === 'rebuild' || !Array.isArray(current?.sourceKeys)
                ? []
                : current.sourceKeys.filter(isKnowledgeSourceKey)
        const citable = key => allowedSourceKeys.has(key) || existingSourceKeys.includes(key)
        const { text: body, removed } = rewriteKnowledgeSourceTokens(rawBody, citable)
        const { pageLinks, sourceKeys: citedSourceKeys } = extractKnowledgeTokens(body)
        const declared = (Array.isArray(declaredSourceKeys) ? declaredSourceKeys : []).filter(
            key => typeof key === 'string' && allowedSourceKeys.has(key)
        )
        const sourceKeys = [...new Set([...existingSourceKeys, ...citedSourceKeys, ...declared])]
        const previousLabels = mode === 'rebuild' ? {} : current?.sourceLabels || {}
        const sourceLabels = {}
        sourceKeys.forEach(key => {
            const label = runSourceLabels[key] || previousLabels[key]
            if (typeof label === 'string' && label.trim()) sourceLabels[key] = clip(label, 120)
        })
        const revision = currentRevision + 1

        const page = {
            slug,
            title,
            summary,
            body,
            sourceKeys,
            sourceLabels,
            links: pageLinks.filter(link => link !== slug),
            revision,
            createdAt: current?.createdAt || now,
            updatedAt: now,
            updatedBy: author.type === 'user' ? author.userId : 'wiki',
            lastRunId: runId,
            archived: false,
            needsRebuild: false,
            needsRebuildSince: fieldValue.delete(),
            needsRebuildReason: fieldValue.delete(),
        }
        if (mode === 'rebuild') page.removedSourceKeys = fieldValue.delete()
        // Every source any revision ever cited, so that a later withdrawal finds the revisions that
        // repeat it even after the page stopped citing it (knowledgeSourceInvalidation).
        if (sourceKeys.length) page.historicalSourceKeys = fieldValue.arrayUnion(...sourceKeys)

        transaction.set(pageRef, page, { merge: true })
        transaction.set(db.doc(`${getKnowledgePageRevisionsPath(projectId, slug)}/${revisionId(revision)}`), {
            revision,
            title,
            summary,
            body,
            sourceKeys,
            archived: false,
            mode,
            author,
            runId,
            reason: clip(reason, 500),
            createdAt: now,
        })

        return {
            success: true,
            slug,
            revision,
            created: !current || current.archived === true,
            removedSourceReferences: removed,
            page: {
                ...page,
                needsRebuildSince: undefined,
                needsRebuildReason: undefined,
                removedSourceKeys: undefined,
                historicalSourceKeys: undefined,
            },
        }
    })
}

async function archiveKnowledgePage({
    db,
    projectId,
    slug: requestedSlug,
    expectedRevision = null,
    mode = 'ingest',
    author = { type: 'ingest' },
    runId = null,
    reason = '',
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    const slug = normalizeKnowledgePageSlug(requestedSlug)
    if (!slug) return failure('archive_page needs a slug.')
    const pageRef = db.doc(getKnowledgePagePath(projectId, slug))

    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(pageRef)
        const current = snapshot.exists ? snapshot.data() || {} : null
        if (!current || current.archived === true) return failure(`There is no page "${slug}".`)
        if (current.needsRebuild === true && mode !== 'rebuild') {
            return failure(`The page "${slug}" is being rebuilt and cannot be edited now.`)
        }
        const currentRevision = Number(current.revision) || 0
        if (mode !== 'rebuild' && Number(expectedRevision) !== currentRevision) {
            return failure(`Read the page "${slug}" with read_page before archiving it.`)
        }

        const revision = currentRevision + 1
        // The text leaves the page document: an archived page is shown nowhere, and its earlier
        // revisions keep the text for an undo.
        transaction.set(
            pageRef,
            {
                archived: true,
                summary: fieldValue.delete(),
                body: fieldValue.delete(),
                revision,
                updatedAt: now,
                updatedBy: author.type === 'user' ? author.userId : 'wiki',
                lastRunId: runId,
                needsRebuild: false,
                needsRebuildSince: fieldValue.delete(),
                needsRebuildReason: fieldValue.delete(),
            },
            { merge: true }
        )
        transaction.set(db.doc(`${getKnowledgePageRevisionsPath(projectId, slug)}/${revisionId(revision)}`), {
            revision,
            archived: true,
            mode,
            author,
            runId,
            reason: clip(reason, 500),
            createdAt: now,
        })
        return { success: true, slug, revision, archived: true }
    })
}

module.exports = {
    KNOWLEDGE_INDEX_MAX_CHARS,
    loadKnowledgePages,
    countActivePages,
    buildKnowledgeIndex,
    writeKnowledgePage,
    archiveKnowledgePage,
}
