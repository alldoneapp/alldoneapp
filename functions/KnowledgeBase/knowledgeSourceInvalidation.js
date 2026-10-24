'use strict'

// When an object stops being visible to the whole project (made private) or is deleted, every wiki
// page that cites it still contains what it contributed. Those pages are marked `needsRebuild`,
// which hides them from people and assistants alike (isKnowledgePageVisible), the source is moved
// from `sourceKeys` to `removedSourceKeys`, and the wiki is scheduled to run now. The rebuild then
// recompiles each marked page from its REMAINING sources; asking a model to "remove what source X
// said" is not reliable, because it cannot tell which sentence came from which source.
//
// Runs from the existing object triggers, so no new trigger is deployed. Only a change that takes
// visibility AWAY does any work, and the work is one array-contains query on the project's pages.

const { FieldValue } = require('firebase-admin/firestore')

const { isVisibleToWholeProject } = require('./collectKnowledgeSources')
const {
    buildKnowledgeSourceKey,
    getKnowledgeBasePath,
    getKnowledgePagesPath,
    toKnowledgeSourceType,
} = require('./knowledgeBaseModel')

// One batch holds 500 writes; a source cited by more pages than that is rebuilt in several.
const INVALIDATION_BATCH_SIZE = 400

async function invalidateKnowledgeSource({
    db,
    projectId,
    sourceKey,
    reason,
    now = Date.now(),
    fieldValue = FieldValue,
}) {
    if (!db || !projectId || !sourceKey) return { pages: 0 }

    const snapshot = await db
        .collection(getKnowledgePagesPath(projectId))
        .where('sourceKeys', 'array-contains', sourceKey)
        .get()
    if (snapshot.empty) return { pages: 0 }

    const pages = snapshot.docs
    for (let index = 0; index < pages.length; index += INVALIDATION_BATCH_SIZE) {
        const batch = db.batch()
        pages.slice(index, index + INVALIDATION_BATCH_SIZE).forEach(page => {
            batch.update(page.ref, {
                needsRebuild: true,
                needsRebuildSince: now,
                needsRebuildReason: reason,
                sourceKeys: fieldValue.arrayRemove(sourceKey),
                removedSourceKeys: fieldValue.arrayUnion(sourceKey),
            })
        })
        if (index === 0) {
            // Pages only exist under a wiki document, so this merge never creates a stray one.
            batch.set(
                db.doc(getKnowledgeBasePath(projectId)),
                { nextRunAt: now, rebuildRequestedAt: now },
                { merge: true }
            )
        }
        await batch.commit()
    }

    return { pages: pages.length }
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
    if (!type) return { pages: 0 }
    if (!isVisibleToWholeProject(before, type) || isVisibleToWholeProject(after, type)) return { pages: 0 }

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
    if (!type) return { pages: 0 }
    // An object the whole project could never see was never compiled into a page.
    if (!isVisibleToWholeProject(data, type)) return { pages: 0 }

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
