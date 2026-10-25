'use strict'

// When an object stops being visible to the whole project (made private) or is deleted, every wiki
// page that cites it still contains what it contributed. Those pages are marked `needsRebuild`,
// which hides them from people and assistants alike (isKnowledgePageVisible), the source is moved
// from `sourceKeys` to `removedSourceKeys`, and the wiki is scheduled to run now. The rebuild then
// recompiles each marked page from its REMAINING sources; asking a model to "remove what source X
// said" is not reliable, because it cannot tell which sentence came from which source.
//
// Hiding is not enough on its own, because hiding is a property of the views and members may read
// the whole knowledgeBases/{projectId} tree straight from Firestore. So what the source contributed
// is also REMOVED, right here rather than at the next run: the page's title, summary, body and the
// source's label, and every stored revision that cited it (`redacted`). A revision is found through
// the page's `historicalSourceKeys` too, because a page may have stopped citing a source long after
// one of its revisions repeated it. The page id (its slug) is the one thing that stays.
//
// Runs from the existing object triggers, so no new trigger is deployed. Only a change that takes
// visibility AWAY does any work, and the work is two array-contains queries on the project's pages
// plus one on the revisions of each page they return.

const { FieldValue } = require('firebase-admin/firestore')

const { isVisibleToWholeProject } = require('./collectKnowledgeSources')
const {
    buildKnowledgeSourceKey,
    getKnowledgeBasePath,
    getKnowledgePageRevisionsPath,
    getKnowledgePagesPath,
    toKnowledgeSourceType,
} = require('./knowledgeBaseModel')

// One batch holds 500 writes; a source cited by more pages and revisions than that is removed in
// several.
const INVALIDATION_BATCH_SIZE = 400

function createBatchWriter(db) {
    let batch = null
    let size = 0
    const commit = async () => {
        if (!batch) return
        await batch.commit()
        batch = null
        size = 0
    }
    return {
        async update(ref, data) {
            if (!batch) batch = db.batch()
            batch.update(ref, data)
            size += 1
            if (size >= INVALIDATION_BATCH_SIZE) await commit()
        },
        async set(ref, data, options) {
            if (!batch) batch = db.batch()
            batch.set(ref, data, options)
            size += 1
            if (size >= INVALIDATION_BATCH_SIZE) await commit()
        },
        flush: commit,
    }
}

async function invalidateKnowledgeSource({
    db,
    projectId,
    sourceKey,
    reason,
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    const result = { pages: 0, redactedRevisions: 0 }
    if (!db || !projectId || !sourceKey) return result

    const pagesCollection = db.collection(getKnowledgePagesPath(projectId))
    const [citing, cited] = await Promise.all([
        pagesCollection.where('sourceKeys', 'array-contains', sourceKey).get(),
        pagesCollection.where('historicalSourceKeys', 'array-contains', sourceKey).get(),
    ])
    const pages = new Map()
    citing.docs.forEach(doc => pages.set(doc.id, { doc, citesNow: true }))
    cited.docs.forEach(doc => !pages.has(doc.id) && pages.set(doc.id, { doc, citesNow: false }))
    if (!pages.size) return result

    const writer = createBatchWriter(db)
    for (const { doc, citesNow } of pages.values()) {
        const revisions = await db
            .collection(getKnowledgePageRevisionsPath(projectId, doc.id))
            .where('sourceKeys', 'array-contains', sourceKey)
            .get()
        for (const revision of revisions.docs) {
            await writer.update(revision.ref, {
                redacted: true,
                redactedAt: now,
                redactedReason: reason,
                title: fieldValue.delete(),
                summary: fieldValue.delete(),
                body: fieldValue.delete(),
                reason: fieldValue.delete(),
            })
            result.redactedRevisions += 1
        }

        const data = doc.data() || {}
        const patch = { historicalSourceKeys: fieldValue.arrayRemove(sourceKey) }
        if (citesNow) {
            const sourceLabels = { ...(data.sourceLabels || {}) }
            delete sourceLabels[sourceKey]
            Object.assign(patch, {
                title: fieldValue.delete(),
                summary: fieldValue.delete(),
                body: fieldValue.delete(),
                sourceLabels,
                sourceKeys: fieldValue.arrayRemove(sourceKey),
                removedSourceKeys: fieldValue.arrayUnion(sourceKey),
            })
            // An archived page has nothing left to rebuild; it only must not keep the text.
            if (data.archived !== true) {
                Object.assign(patch, { needsRebuild: true, needsRebuildSince: now, needsRebuildReason: reason })
                result.pages += 1
            }
        }
        await writer.update(doc.ref, patch)
    }

    if (result.pages > 0) {
        // Pages only exist under a wiki document, so this merge never creates a stray one.
        await writer.set(
            db.doc(getKnowledgeBasePath(projectId)),
            { nextRunAt: now, rebuildRequestedAt: now },
            { merge: true }
        )
    }
    await writer.flush()

    return result
}

async function invalidateKnowledgeSourcesOnUpdate({
    db,
    projectId,
    objectType,
    objectId,
    before,
    after,
    now,
    fieldValue,
}) {
    const type = toKnowledgeSourceType(objectType)
    if (!type) return { pages: 0, redactedRevisions: 0 }
    if (!isVisibleToWholeProject(before, type) || isVisibleToWholeProject(after, type)) {
        return { pages: 0, redactedRevisions: 0 }
    }

    return invalidateKnowledgeSource({
        db,
        projectId,
        sourceKey: buildKnowledgeSourceKey(type, objectId),
        reason: 'privacy',
        now,
        fieldValue,
    })
}

async function invalidateKnowledgeSourcesOnDelete({ db, projectId, objectType, objectId, data, now, fieldValue }) {
    const type = toKnowledgeSourceType(objectType)
    if (!type) return { pages: 0, redactedRevisions: 0 }
    // An object the whole project could never see was never compiled into a page.
    if (!isVisibleToWholeProject(data, type)) return { pages: 0, redactedRevisions: 0 }

    return invalidateKnowledgeSource({
        db,
        projectId,
        sourceKey: buildKnowledgeSourceKey(type, objectId),
        reason: 'deleted',
        now,
        fieldValue,
    })
}

module.exports = {
    invalidateKnowledgeSource,
    invalidateKnowledgeSourcesOnUpdate,
    invalidateKnowledgeSourcesOnDelete,
}
