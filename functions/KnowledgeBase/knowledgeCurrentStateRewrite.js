'use strict'

// A one-time pass over the pages a wiki already has, rewriting each to its current state.
//
// Pages written before the current-state rules (WIKI_RULES in knowledgeBaseIngest.js) can still
// narrate meetings or keep options that a decision has since settled, and an ingest run only
// rewrites a page when one of its sources changes, so a page about a settled question would keep
// its history forever. Asking for the pass stores the slugs to rewrite on the wiki document as
// `currentStateRewrite: { requestedAt, pendingSlugs }` and makes the wiki due now; the ingest run
// then works through them after its rebuilds, a few per run, each from the sources the page cites,
// billed like any other run and stopped by the same monthly cap. Only the run holding the lease
// shortens the list, and it removes the field once the list is empty.
//
// Requested from migration/rewriteKnowledgeBasesToCurrentState.js.

const { getKnowledgeBasePath, isKnowledgePageVisible, normalizeKnowledgePageSlug } = require('./knowledgeBaseModel')
const { loadKnowledgePages } = require('./knowledgePageStore')

// A page that is archived or waiting for a rebuild is not rewritten: the rebuild already writes it
// under the current rules, and nothing it lost may come back.
function selectPagesForCurrentStateRewrite(pages) {
    return [...pages.values()]
        .filter(isKnowledgePageVisible)
        .map(page => page.slug)
        .sort()
}

// The pending slugs of a stored request, or null when there is none. The document is written only
// by Cloud Functions, but a run never trusts a stored value it is about to act on.
function readPendingRewriteSlugs(request) {
    if (!request || !Array.isArray(request.pendingSlugs)) return null
    return [...new Set(request.pendingSlugs.map(normalizeKnowledgePageSlug).filter(Boolean))]
}

async function requestCurrentStateRewrite({ db, projectId, now = Date.now(), dryRun = false, force = false }) {
    const ref = db.doc(getKnowledgeBasePath(projectId))
    const snapshot = await ref.get()
    const knowledgeBase = snapshot.exists ? snapshot.data() || {} : null
    if (!knowledgeBase || knowledgeBase.enabled !== true) return { requested: false, reason: 'disabled', slugs: [] }
    if (!force && readPendingRewriteSlugs(knowledgeBase.currentStateRewrite)?.length) {
        return {
            requested: false,
            reason: 'already_requested',
            slugs: readPendingRewriteSlugs(knowledgeBase.currentStateRewrite),
        }
    }

    const slugs = selectPagesForCurrentStateRewrite(await loadKnowledgePages(db, projectId))
    if (!slugs.length) return { requested: false, reason: 'no_pages', slugs }
    if (dryRun) return { requested: false, reason: 'dry_run', slugs }

    // A transaction so the request cannot switch a wiki back on that was disabled in the meantime:
    // a disabled wiki has nextRunAt null, and a due date would make the dispatcher pick it up again.
    return db.runTransaction(async transaction => {
        const current = await transaction.get(ref)
        const data = current.exists ? current.data() || {} : null
        if (!data || data.enabled !== true) return { requested: false, reason: 'disabled', slugs: [] }
        const scheduled = Number(data.nextRunAt)
        transaction.update(ref, {
            currentStateRewrite: { requestedAt: now, pendingSlugs: slugs },
            nextRunAt: Number.isFinite(scheduled) ? Math.min(scheduled, now) : now,
        })
        return { requested: true, reason: null, slugs }
    })
}

module.exports = {
    readPendingRewriteSlugs,
    requestCurrentStateRewrite,
    selectPagesForCurrentStateRewrite,
}
