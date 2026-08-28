'use strict'

const { FieldPath } = require('firebase-admin/firestore')

const FEED_PUBLIC_FOR_ALL = 0
const ACCESS_PROJECTION_FIELDS = [
    'readerIds',
    'roleIdsVisibleTo',
    'followedByVisibleTo',
    'followedReaderIds',
    'backlinkIdsVisibleTo',
]
const LINKED_PARENT_FIELDS = [
    'linkedParentNotesIds',
    'linkedParentTasksIds',
    'linkedParentContactsIds',
    'linkedParentProjectsIds',
    'linkedParentGoalsIds',
    'linkedParentSkillsIds',
    'linkedParentAssistantIds',
    // Preserve the misspelled legacy field used by a small number of old documents.
    'linkedParentAsistantIds',
]
const DEFAULT_PROJECTION_PAGE_SIZE = 400
const MAX_NESTED_COLLECTIONS_PER_PAGE = 25

const OBJECT_COLLECTIONS = [
    { root: 'items', child: 'tasks', roleField: 'observersIds' },
    { root: 'noteItems', child: 'notes', followerField: 'isVisibleInFollowedFor' },
    { root: 'goals', child: 'items', roleField: 'assigneesIds' },
    { root: 'chatObjects', child: 'chats', followerField: 'usersFollowing' },
    { root: 'projectsContacts', child: 'contacts' },
    { root: 'skills', child: 'items' },
    { root: 'okrs', child: 'projectOkrs' },
]

function uniqueStrings(values) {
    if (!Array.isArray(values)) return []
    return Array.from(new Set(values.filter(value => typeof value === 'string' && value.length > 0))).sort()
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value)
        if (prototype === Object.prototype || prototype === null) {
            return Object.fromEntries(
                Object.keys(value)
                    .sort()
                    .map(key => [key, canonicalize(value[key])])
            )
        }
    }
    return value
}

function valuesEqual(left, right) {
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function buildBacklinkToken(idsField, objectId) {
    return JSON.stringify([idsField, objectId])
}

function getBacklinkTokens(objectData) {
    const tokens = []
    LINKED_PARENT_FIELDS.forEach(idsField => {
        uniqueStrings(objectData[idsField]).forEach(objectId => {
            tokens.push(buildBacklinkToken(idsField, objectId))
        })
    })
    return tokens.sort()
}

function buildObjectAccessProjection(objectData = {}, projectUserIds = [], roleField, followerField) {
    const projectMembers = uniqueStrings(projectUserIds)
    const projectMemberSet = new Set(projectMembers)
    const isPublicFor = Array.isArray(objectData.isPublicFor) ? objectData.isPublicFor : []
    const isProjectPublic = isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
    const readerIds = isProjectPublic
        ? [FEED_PUBLIC_FOR_ALL, ...projectMembers]
        : uniqueStrings(isPublicFor).filter(userId => projectMemberSet.has(userId))

    const roleIds = roleField ? uniqueStrings(objectData[roleField]) : []
    const roleReaderIds = isProjectPublic ? [String(FEED_PUBLIC_FOR_ALL), ...projectMembers] : readerIds
    const roleIdsVisibleTo = Object.fromEntries(roleReaderIds.map(readerId => [readerId, roleIds]))
    const followerIds = followerField ? new Set(uniqueStrings(objectData[followerField])) : new Set()
    const followedByVisibleTo = Object.fromEntries(
        readerIds
            .filter(readerId => typeof readerId === 'string' && followerIds.has(readerId))
            .map(readerId => [readerId, true])
    )
    // Keep a fixed array field for compound followed-object queries. A map path such as
    // followedByVisibleTo.<uid> would require a separate composite index for every user.
    const followedReaderIds = Object.keys(followedByVisibleTo)
    const backlinkTokens = getBacklinkTokens(objectData)
    // Backlink queries already need `array-contains` for the linked object id, so they cannot also
    // constrain readerIds. Keying the token list by reader makes the one array predicate prove
    // both the relationship and read access without exposing private matches to the client.
    const backlinkIdsVisibleTo = backlinkTokens.length
        ? Object.fromEntries(readerIds.map(readerId => [String(readerId), backlinkTokens]))
        : {}

    return { readerIds, roleIdsVisibleTo, followedByVisibleTo, followedReaderIds, backlinkIdsVisibleTo }
}

function isAccessProjectionOnlyChange(beforeData = {}, afterData = {}) {
    const keys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)])
    for (const key of keys) {
        if (ACCESS_PROJECTION_FIELDS.includes(key)) continue
        if (!valuesEqual(beforeData[key], afterData[key])) return false
    }
    return true
}

function projectionsEqual(objectData = {}, projection) {
    return ACCESS_PROJECTION_FIELDS.every(field => {
        const emptyValue =
            field === 'roleIdsVisibleTo' || field === 'followedByVisibleTo' || field === 'backlinkIdsVisibleTo'
                ? {}
                : []
        return valuesEqual(objectData[field] ?? emptyValue, projection[field])
    })
}

async function synchronizeObjectAccessProjection({
    db,
    documentSnapshot,
    projectId,
    projectUserIds,
    roleField,
    followerField,
}) {
    if (!documentSnapshot?.exists) return false

    let members = projectUserIds
    if (!Array.isArray(members)) {
        const projectSnapshot = await db.doc(`projects/${projectId}`).get()
        members = projectSnapshot.exists ? projectSnapshot.data()?.userIds : []
    }

    const objectData = documentSnapshot.data() || {}
    const projection = buildObjectAccessProjection(objectData, members, roleField, followerField)
    if (projectionsEqual(objectData, projection)) return false

    await documentSnapshot.ref.set(projection, { merge: true })
    return true
}

async function listProjectProjectionGroups(db, projectId) {
    const groups = await Promise.all(
        OBJECT_COLLECTIONS.map(async spec => ({
            spec,
            snapshot: await db.collection(`${spec.root}/${projectId}/${spec.child}`).get(),
        }))
    )

    const projectFeedCollections = await db.doc(`projectsFeeds/${projectId}`).listCollections()
    for (const feedCollection of projectFeedCollections) {
        groups.push({ spec: {}, snapshot: await feedCollection.get() })
    }

    const innerFeedTypeCollections = await db.doc(`projectsInnerFeeds/${projectId}`).listCollections()
    for (const objectTypeCollection of innerFeedTypeCollections) {
        const objectSnapshot = await objectTypeCollection.get()
        for (const objectDoc of objectSnapshot.docs) {
            groups.push({ spec: {}, snapshot: await objectDoc.ref.collection('feeds').get() })
        }
    }

    return groups
}

async function synchronizeProjectAccessProjections(db, projectId, projectUserIds) {
    const groups = await listProjectProjectionGroups(db, projectId)
    const writer = db.bulkWriter()
    let updated = 0

    groups.forEach(({ snapshot, spec }) => {
        snapshot.docs.forEach(documentSnapshot => {
            const objectData = documentSnapshot.data() || {}
            const projection = buildObjectAccessProjection(
                objectData,
                projectUserIds,
                spec.roleField,
                spec.followerField
            )
            if (projectionsEqual(objectData, projection)) return
            writer.set(documentSnapshot.ref, projection, { merge: true })
            updated++
        })
    })

    await writer.close()
    return { scanned: groups.reduce((total, group) => total + group.snapshot.size, 0), updated }
}

function getInitialProjectionCursor() {
    return { phase: 'objects', specIndex: 0, documentId: null }
}

async function getDocumentPage(collectionRef, documentId, pageSize) {
    let query = collectionRef.orderBy(FieldPath.documentId()).limit(pageSize)
    if (documentId) query = query.startAfter(documentId)
    return query.get()
}

async function applyProjectionPage(db, snapshot, spec, projectUserIds, write) {
    const updates = []
    snapshot.docs.forEach(documentSnapshot => {
        const objectData = documentSnapshot.data() || {}
        const projection = buildObjectAccessProjection(objectData, projectUserIds, spec.roleField, spec.followerField)
        if (!projectionsEqual(objectData, projection)) updates.push({ ref: documentSnapshot.ref, projection })
    })

    if (write && updates.length > 0) {
        const writer = db.bulkWriter()
        updates.forEach(({ ref, projection }) => writer.set(ref, projection, { merge: true }))
        await writer.close()
    }

    return { scanned: snapshot.size, updated: updates.length }
}

function collectionIndex(collections, currentId) {
    if (!currentId) return 0
    const exactIndex = collections.findIndex(collection => collection.id === currentId)
    if (exactIndex >= 0) return exactIndex
    return collections.findIndex(collection => collection.id > currentId)
}

/**
 * Reconciles at most one bounded page for a project and returns a serializable
 * cursor for the next invocation. Membership changes can affect thousands of
 * nested feed documents, so this is intentionally resumable instead of doing
 * an unbounded read/write inside the ordinary project update trigger.
 */
async function synchronizeProjectAccessProjectionPage(
    db,
    projectId,
    projectUserIds,
    cursor = getInitialProjectionCursor(),
    pageSize = DEFAULT_PROJECTION_PAGE_SIZE,
    write = true
) {
    let current = cursor && typeof cursor === 'object' ? { ...cursor } : getInitialProjectionCursor()
    const totals = { scanned: 0, updated: 0 }
    let nestedCollectionsVisited = 0
    const addStats = stats => {
        totals.scanned += stats.scanned
        totals.updated += stats.updated
    }
    const continueAt = nextCursor => ({ ...totals, done: false, cursor: nextCursor })

    if (current.phase === 'objects') {
        let specIndex = Number.isInteger(current.specIndex) ? current.specIndex : 0
        while (specIndex < OBJECT_COLLECTIONS.length) {
            const spec = OBJECT_COLLECTIONS[specIndex]
            const remaining = pageSize - totals.scanned
            const snapshot = await getDocumentPage(
                db.collection(`${spec.root}/${projectId}/${spec.child}`),
                current.documentId,
                remaining
            )
            const stats = await applyProjectionPage(db, snapshot, spec, projectUserIds, write)
            addStats(stats)
            if (snapshot.size === remaining) {
                return continueAt({
                    phase: 'objects',
                    specIndex,
                    documentId: snapshot.docs[snapshot.docs.length - 1].id,
                })
            }

            specIndex++
            current = { phase: 'objects', specIndex, documentId: null }
        }
        current = { phase: 'project-feeds', collectionId: null, documentId: null }
    }

    if (current.phase === 'project-feeds') {
        const collections = (await db.doc(`projectsFeeds/${projectId}`).listCollections()).sort((a, b) =>
            a.id.localeCompare(b.id)
        )
        let index = collectionIndex(collections, current.collectionId)
        while (index >= 0 && index < collections.length) {
            const collection = collections[index]
            const remaining = pageSize - totals.scanned
            const snapshot = await getDocumentPage(collection, current.documentId, remaining)
            const stats = await applyProjectionPage(db, snapshot, {}, projectUserIds, write)
            addStats(stats)
            nestedCollectionsVisited++
            if (snapshot.size === remaining) {
                return continueAt({
                    phase: 'project-feeds',
                    collectionId: collection.id,
                    documentId: snapshot.docs[snapshot.docs.length - 1].id,
                })
            }

            index++
            current = {
                phase: 'project-feeds',
                collectionId: collections[index]?.id || null,
                documentId: null,
            }
            if (current.collectionId && nestedCollectionsVisited >= MAX_NESTED_COLLECTIONS_PER_PAGE) {
                return continueAt(current)
            }
        }
        current = { phase: 'inner-feeds', typeId: null, objectId: null, documentId: null }
    }

    if (current.phase === 'inner-feeds') {
        const typeCollections = (await db.doc(`projectsInnerFeeds/${projectId}`).listCollections()).sort((a, b) =>
            a.id.localeCompare(b.id)
        )
        let typeIndex = collectionIndex(typeCollections, current.typeId)

        while (typeIndex >= 0 && typeIndex < typeCollections.length) {
            const typeCollection = typeCollections[typeIndex]
            let objectId = current.typeId === typeCollection.id ? current.objectId : null
            if (!objectId) {
                const objectSnapshot = await getDocumentPage(typeCollection, null, 1)
                objectId = objectSnapshot.docs[0]?.id || null
            }

            if (!objectId) {
                typeIndex++
                current = {
                    phase: 'inner-feeds',
                    typeId: typeCollections[typeIndex]?.id || null,
                    objectId: null,
                    documentId: null,
                }
                continue
            }

            const feedsRef = typeCollection.doc(objectId).collection('feeds')
            const remaining = pageSize - totals.scanned
            const snapshot = await getDocumentPage(feedsRef, current.documentId, remaining)
            const stats = await applyProjectionPage(db, snapshot, {}, projectUserIds, write)
            addStats(stats)
            nestedCollectionsVisited++
            if (snapshot.size === remaining) {
                return continueAt({
                    phase: 'inner-feeds',
                    typeId: typeCollection.id,
                    objectId,
                    documentId: snapshot.docs[snapshot.docs.length - 1].id,
                })
            }

            const nextObjectSnapshot = await getDocumentPage(typeCollection, objectId, 1)
            const nextObjectId = nextObjectSnapshot.docs[0]?.id || null
            if (nextObjectId) {
                current = {
                    phase: 'inner-feeds',
                    typeId: typeCollection.id,
                    objectId: nextObjectId,
                    documentId: null,
                }
            } else {
                typeIndex++
                current = {
                    phase: 'inner-feeds',
                    typeId: typeCollections[typeIndex]?.id || null,
                    objectId: null,
                    documentId: null,
                }
            }
            if (current.typeId && nestedCollectionsVisited >= MAX_NESTED_COLLECTIONS_PER_PAGE) {
                return continueAt(current)
            }
        }
    }

    return { ...totals, done: true, cursor: null }
}

module.exports = {
    ACCESS_PROJECTION_FIELDS,
    LINKED_PARENT_FIELDS,
    OBJECT_COLLECTIONS,
    buildBacklinkToken,
    buildObjectAccessProjection,
    getInitialProjectionCursor,
    isAccessProjectionOnlyChange,
    listProjectProjectionGroups,
    synchronizeObjectAccessProjection,
    synchronizeProjectAccessProjectionPage,
    synchronizeProjectAccessProjections,
    valuesEqual,
}
