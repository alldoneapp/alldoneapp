'use strict'

const admin = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')

const { BatchWrapper } = require('../BatchWrapper/batchWrapper')

// Mirrors HelperFunctionsCloud's sentinel without pulling that module (and its firebase-functions
// params) into a helper that has to stay cheap to load from a trigger.
const FEED_PUBLIC_FOR_ALL = 0

/**
 * The SERVER half of a privacy change's activity fan-out.
 *
 * Every activity entry of an object — the `feedsStore/{projectId}/all` store, each member's
 * `followed` store and the object's `projectsInnerFeeds` history — carries its own `isPublicFor`,
 * and the access projection derives each document's `readerIds` from that field. When the object's
 * privacy changes those entries have to follow, or members who lost access keep reading the old
 * activity and members who gained it never see it.
 *
 * The browser does its share (`utils/backends/Feeds/feedPrivacy.js`), but under the hardened rules
 * it can reach only its own followed store and the shared stores it can prove readable. It cannot
 * read — let alone delete from — another member's followed store, and it cannot rewrite an entry
 * to a privacy that no longer names itself. Those parts run here, from the object's own update
 * trigger, with the Admin SDK.
 *
 * Idempotent by construction: the writes are merges to a value derived from the object, and the
 * deletes target entries that should not exist. Running twice (a client half plus this, a retried
 * trigger, the assistant's own server-side chain) converges on the same state.
 */

const uniqueIds = values =>
    Array.isArray(values) ? Array.from(new Set(values.filter(value => typeof value === 'string' && value))) : []

const normalizeReaders = isPublicFor =>
    Array.isArray(isPublicFor)
        ? [...new Set(isPublicFor.map(reader => (reader === FEED_PUBLIC_FOR_ALL ? reader : String(reader))))]
        : null

const readersKey = isPublicFor => {
    const readers = normalizeReaders(isPublicFor)
    return readers ? JSON.stringify(readers.map(String).sort()) : null
}

function hasFeedPrivacyChanged(before = {}, after = {}) {
    return readersKey(before?.isPublicFor) !== readersKey(after?.isPublicFor)
}

function resolveFeedPrivacyReaders(isPublicFor, projectUserIds) {
    const readers = normalizeReaders(isPublicFor) || []
    const members = uniqueIds(projectUserIds)
    const isProjectWide = readers.includes(FEED_PUBLIC_FOR_ALL)
    return {
        isProjectWide,
        usersWithAccess: isProjectWide ? members : members.filter(userId => readers.includes(userId)),
        usersWithoutAccess: isProjectWide ? [] : members.filter(userId => !readers.includes(userId)),
    }
}

// A comment feed may be shared with readers the object itself is not (`isCommentPublicFor`).
function mergeFeedPrivacy(feed, isPublicFor) {
    const usersWithAccess = [...isPublicFor]
    const commentReaders = Array.isArray(feed?.isCommentPublicFor) ? feed.isCommentPublicFor : []
    commentReaders.forEach(userId => {
        if (!usersWithAccess.includes(userId)) usersWithAccess.push(userId)
    })
    return usersWithAccess
}

const followedStorePath = (projectId, userId) => `feedsStore/${projectId}/${userId}/feeds/followed`

/**
 * Re-privatises every stored activity entry of one object. Resolves with what was written.
 */
async function reconcileObjectFeedPrivacy({ database, projectId, objectType, objectId, isPublicFor, projectUserIds }) {
    const readers = normalizeReaders(isPublicFor)
    if (!readers || !projectId || !objectType || !objectId) return { deleted: 0, updated: 0, counters: 0 }

    const { usersWithAccess, usersWithoutAccess } = resolveFeedPrivacyReaders(readers, projectUserIds)
    const batch = new BatchWrapper(database)
    const totals = { deleted: 0, updated: 0, counters: 0 }
    const feedsOf = path => database.collection(path).where('objectId', '==', objectId).get()

    const work = []
    usersWithoutAccess.forEach(userId => {
        const counterEntry = { [objectType]: { [objectId]: FieldValue.delete() } }
        batch.set(database.doc(`feedsCount/${projectId}/${userId}/followed`), counterEntry, { merge: true })
        batch.set(database.doc(`feedsCount/${projectId}/${userId}/all`), counterEntry, { merge: true })
        totals.counters++

        const path = followedStorePath(projectId, userId)
        work.push(
            feedsOf(path).then(snapshot => {
                snapshot.docs.forEach(feedDoc => {
                    batch.delete(database.doc(`${path}/${feedDoc.id}`))
                    totals.deleted++
                })
            })
        )
    })

    const pathsToRewrite = [
        ...usersWithAccess.map(userId => followedStorePath(projectId, userId)),
        `feedsStore/${projectId}/all`,
        `projectsInnerFeeds/${projectId}/${objectType}/${objectId}/feeds`,
    ]
    pathsToRewrite.forEach(path => {
        work.push(
            feedsOf(path).then(snapshot => {
                snapshot.docs.forEach(feedDoc => {
                    batch.set(
                        database.doc(`${path}/${feedDoc.id}`),
                        { isPublicFor: mergeFeedPrivacy(feedDoc.data(), readers) },
                        { merge: true }
                    )
                    totals.updated++
                })
            })
        )
    })

    await Promise.all(work)
    await batch.commit()
    return totals
}

/**
 * Trigger entry point: reconciles when — and only when — the update moved `isPublicFor`.
 * Resolves with the totals, or `null` when there was nothing to do.
 */
async function reconcileObjectFeedPrivacyOnUpdate({
    database = admin.firestore(),
    projectId,
    objectType,
    objectId,
    before = {},
    after = {},
}) {
    if (!hasFeedPrivacyChanged(before, after)) return null
    if (!normalizeReaders(after?.isPublicFor)) return null

    const projectSnapshot = await database.doc(`projects/${projectId}`).get()
    if (!projectSnapshot.exists) return null

    return reconcileObjectFeedPrivacy({
        database,
        projectId,
        objectType,
        objectId,
        isPublicFor: after.isPublicFor,
        projectUserIds: projectSnapshot.data()?.userIds,
    })
}

module.exports = {
    hasFeedPrivacyChanged,
    mergeFeedPrivacy,
    reconcileObjectFeedPrivacy,
    reconcileObjectFeedPrivacyOnUpdate,
    resolveFeedPrivacyReaders,
}
