/**
 * AT-2258 — one-shot repair of the "Only objects I created" search filter.
 *
 * The feature filters each Algolia index on the attribute that carries its
 * creator (`userId` for tasks/notes, `recorderUserId` for contacts,
 * `creatorId` for goals and chats). Tasks, notes and contacts worked the day
 * the feature shipped because their attributes were already declared and
 * populated. Goals and chats did not, for two independent reasons that both
 * fail SILENTLY — Algolia answers a filter it cannot satisfy with an empty
 * result set, not an error, so the tab simply renders "no results":
 *
 *   1. THE FACET WAS NEVER DECLARED IN PRODUCTION. `configAlgoliaIndex` is the
 *      only thing that pushes `attributesForFaceting`, and no deploy calls it —
 *      it runs from `createAlgoliaIndexes` and from `uploadObjectsToAlgolia`.
 *      Shipping a new `filterOnly(creatorId)` line therefore changed nothing.
 *   2. DECLARING A FACET DOES NOT BACKFILL IT. Records indexed before the
 *      matching `map*Data` change carry no such attribute at all. Measured in
 *      production: 0 of 634 goal records had `creatorId`, and 2 of 337 chat
 *      records.
 *
 * Both source collections DO carry `creatorId` on every document, including
 * ones written in 2021, so a plain reindex is sufficient — no data migration.
 *
 * This module fixes (1) directly and once, then delegates (2) to the existing
 * per-project indexation machinery by writing the `algoliaIndexation` trigger
 * docs. Doing (1) separately matters: if a single project's reindex fails, the
 * facet is still declared, so every project that did succeed filters correctly
 * instead of the whole feature staying dark.
 */
const admin = require('firebase-admin')

const MIGRATION_MARKER = 'systemMigrations/AT-2258-creator-facet-reindex'

// Only these two need repairing. Tasks/notes/contacts are already correct in
// production and reindexing them would be a large, pointless Algolia burst.
const OBJECT_TYPES_TO_REINDEX = ['goals', 'chats']

// The per-project indexation functions are `onDocumentCreated` triggers with a
// 540s timeout and 2GiB each, so the trigger docs are written in chunks rather
// than all at once.
const PROJECT_CHUNK_SIZE = 10

const chunk = (items, size) => {
    const chunks = []
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
    return chunks
}

/**
 * Pushes `attributesForFaceting` for the goals and chats indexes.
 *
 * This is the half that makes `filters: creatorId:"<uid>"` legal at all. It is
 * index-wide rather than per-project, so it runs exactly once per call.
 */
const pushCreatorFacetSettings = async () => {
    const {
        getAlgoliaClient,
        configAlgoliaIndex,
        getIndexName,
        GOALS_OBJECTS_TYPE,
        CHATS_OBJECTS_TYPE,
    } = require('../searchHelper')

    const algoliaClient = getAlgoliaClient()
    const pushed = []
    for (const objectsType of [GOALS_OBJECTS_TYPE, CHATS_OBJECTS_TYPE]) {
        const indexName = getIndexName(objectsType)
        await configAlgoliaIndex(algoliaClient.initIndex(indexName), objectsType)
        pushed.push(indexName)
    }
    return pushed
}

/**
 * The projects whose records are reachable from the search popup. A project is
 * indexed when it is activated (`startProjectIndexationInAlgolia`), so `active`
 * is the same condition that put the records in Algolia in the first place.
 * Anything else (archived, template) can be repaired by passing `projectIds`
 * explicitly.
 */
const getActiveProjectIds = async () => {
    const snapshot = await admin.firestore().collection('projects').where('active', '==', true).get()
    return snapshot.docs.map(doc => doc.id)
}

/**
 * Queues a reindex of one object type for one project.
 *
 * The trigger is `onDocumentCreated`, and `startGoalsIndextion` /
 * `startChatsIndextion` delete the doc when they finish — so in the normal case
 * it does not exist and a plain `set` fires the trigger. A doc left behind by
 * an aborted run would make `set` an UPDATE, which fires nothing at all, so it
 * is deleted first. That delete is the difference between this working and it
 * silently doing nothing on exactly the projects that failed last time.
 */
const queueProjectReindex = async (projectId, objectType) => {
    const ref = admin.firestore().doc(`algoliaIndexation/${projectId}/objectTypes/${objectType}`)
    const existing = await ref.get()
    if (existing.exists) await ref.delete()
    // `activeFullSearchDate: null` means "ordinary reindex": it reuses the
    // project's own `activeFullSearch` breadth and skips the full-search
    // bookkeeping, so this repair cannot grant or extend a premium full search.
    await ref.set({ activeFullSearchDate: null })
}

/**
 * @param {string[]} [projectIds] repair these projects instead of every active one
 * @param {boolean}  [force]      run again even if the marker says it completed
 */
const runCreatorFacetReindex = async ({ projectIds, force = false } = {}) => {
    const db = admin.firestore()
    const markerRef = db.doc(MIGRATION_MARKER)
    const marker = await markerRef.get()
    const explicitProjects = Array.isArray(projectIds) && projectIds.length > 0

    // An explicit project list is always an operator asking for those projects
    // specifically, so it is never blocked by the marker.
    if (marker.exists && marker.data().completed && !force && !explicitProjects) {
        return { alreadyCompleted: true, projects: 0, queued: 0, indexesConfigured: [] }
    }

    const indexesConfigured = await pushCreatorFacetSettings()

    const targetProjectIds = explicitProjects ? projectIds : await getActiveProjectIds()

    let queued = 0
    const failures = []
    for (const projectIdsChunk of chunk(targetProjectIds, PROJECT_CHUNK_SIZE)) {
        const results = await Promise.all(
            projectIdsChunk.flatMap(projectId =>
                OBJECT_TYPES_TO_REINDEX.map(objectType =>
                    queueProjectReindex(projectId, objectType).then(
                        () => true,
                        error => {
                            failures.push(`${projectId}/${objectType}: ${error.message}`)
                            return false
                        }
                    )
                )
            )
        )
        queued += results.filter(Boolean).length
    }

    const summary = {
        alreadyCompleted: false,
        projects: targetProjectIds.length,
        queued,
        indexesConfigured,
        failures,
    }
    console.log('[AT-2258] creator facet reindex', JSON.stringify(summary))

    // Only a clean full run closes the migration. A partial run stays open so
    // the scheduled pass retries it, and an explicitly-scoped run never claims
    // to have covered everything.
    if (!explicitProjects && failures.length === 0) {
        await markerRef.set({
            completed: true,
            completedAt: Date.now(),
            projects: targetProjectIds.length,
            queued,
        })
    }

    return summary
}

module.exports = {
    runCreatorFacetReindex,
    pushCreatorFacetSettings,
    queueProjectReindex,
    getActiveProjectIds,
    MIGRATION_MARKER,
    OBJECT_TYPES_TO_REINDEX,
    PROJECT_CHUNK_SIZE,
}
