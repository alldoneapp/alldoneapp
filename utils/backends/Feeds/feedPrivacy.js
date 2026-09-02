import { FEED_PUBLIC_FOR_ALL } from '../../../components/Feeds/Utils/FeedsConstants'

/**
 * The CLIENT half of a privacy change's activity fan-out.
 *
 * When an object becomes private (or public again) every activity entry that already exists for it
 * has to follow: the `feedsStore/{projectId}/all` store, the per-user `followed` stores and the
 * object's own `projectsInnerFeeds` history all carry an `isPublicFor` of their own, and the server
 * projects each document's `readerIds` from THAT field, not from the object's. Until the readerIds
 * rollout (2026-08-28) the browser rewrote all of them itself and deleted the entries out of the
 * followed stores of the members that lost access. Under the hardened rules a browser can only
 *
 *   - query a feed collection through the reader projection (`readerIds array-contains <me>`;
 *     a bare `objectId ==` query cannot prove `canReadObject` and is refused as a whole), and
 *   - read its OWN followed store — `feedsStore/{projectId}/{userId}/feeds/followed` is gated on
 *     `request.auth.uid == userId`, so another member's store is unreachable however the query is
 *     shaped.
 *
 * So the browser does exactly what it can see — its own followed store, the shared store and the
 * object's history — and the members it cannot reach are reconciled server-side from the object
 * update (`functions/Feeds/objectFeedPrivacy.js`, run by the `onUpdate*` triggers). Keeping the
 * client half is what makes the Updates view consistent immediately for the person who made the
 * change, without waiting for a trigger.
 */

const readerIdsClause = ['readerIds', 'array-contains']

const listVisibleFeeds = (db, path, objectId, readerId) =>
    db
        .collection(path)
        .where('objectId', '==', objectId)
        .where(...readerIdsClause, readerId)
        .get()

export const getFeedPrivacyReaders = (isPublicFor, projectUserIds) => {
    const readers = Array.isArray(isPublicFor) ? isPublicFor : []
    const members = Array.isArray(projectUserIds) ? projectUserIds : []
    const isProjectWide = readers.includes(FEED_PUBLIC_FOR_ALL)
    return {
        isProjectWide,
        usersWithAccess: isProjectWide ? members : members.filter(userId => readers.includes(userId)),
        usersWithoutAccess: isProjectWide ? [] : members.filter(userId => !readers.includes(userId)),
    }
}

/**
 * A comment feed can be visible to people the object itself is not shared with
 * (`isCommentPublicFor`); those readers keep it.
 */
export const mergeFeedPrivacy = (feed, isPublicFor) => {
    const usersWithAccess = [...isPublicFor]
    const commentReaders = Array.isArray(feed?.isCommentPublicFor) ? feed.isCommentPublicFor : []
    commentReaders.forEach(userId => {
        if (!usersWithAccess.includes(userId)) usersWithAccess.push(userId)
    })
    return usersWithAccess
}

/**
 * The feed update rule checks `canWriteObject` on the document as written, i.e. the NEW
 * `isPublicFor` must still name the writer (or the project). A member who takes their own access
 * away cannot rewrite the entries; they can only remove them from their own store.
 */
export const canWriteFeedPrivacyAs = (isPublicFor, userId) =>
    Array.isArray(isPublicFor) && (isPublicFor.includes(FEED_PUBLIC_FOR_ALL) || isPublicFor.includes(userId))

export const getOwnFollowedStorePath = (projectId, userId) => `/feedsStore/${projectId}/${userId}/feeds/followed`

/**
 * Removes every entry of `objectId` from the signed-in user's own followed store. Only the owner
 * can read that store, so `userId` must be the signed-in user; anyone else's store is left to the
 * server and the call is a no-op. Writes into `batch`; resolves with the number of deletes queued.
 */
export async function deleteVisibleFollowedFeeds(db, batch, { projectId, userId, loggedUserId, objectId, readerId }) {
    if (!userId || userId !== loggedUserId) return 0
    const path = getOwnFollowedStorePath(projectId, userId)
    const snapshot = await listVisibleFeeds(db, path, objectId, readerId)
    snapshot.docs.forEach(feedDoc => batch.delete(db.doc(`${path}/${feedDoc.id}`)))
    return snapshot.docs.length
}

/**
 * Rewrites the privacy of every activity entry of `objectId` the signed-in user can see, or —
 * when the change takes their own access away — removes the entries from their followed store.
 * Writes into `batch` and resolves with what was queued.
 */
export async function applyVisibleFeedPrivacy(
    db,
    batch,
    { projectId, objectId, objectTypes, isPublicFor, loggedUserId, readerId }
) {
    if (!loggedUserId) return { deleted: 0, updated: 0 }

    if (!canWriteFeedPrivacyAs(isPublicFor, loggedUserId)) {
        const deleted = await deleteVisibleFollowedFeeds(db, batch, {
            projectId,
            userId: loggedUserId,
            loggedUserId,
            objectId,
            readerId,
        })
        return { deleted, updated: 0 }
    }

    const paths = [
        getOwnFollowedStorePath(projectId, loggedUserId),
        `/feedsStore/${projectId}/all`,
        `projectsInnerFeeds/${projectId}/${objectTypes}/${objectId}/feeds`,
    ]
    const snapshots = await Promise.all(paths.map(path => listVisibleFeeds(db, path, objectId, readerId)))

    let updated = 0
    snapshots.forEach((snapshot, index) => {
        snapshot.docs.forEach(feedDoc => {
            batch.set(
                db.doc(`${paths[index]}/${feedDoc.id}`),
                { isPublicFor: mergeFeedPrivacy(feedDoc.data(), isPublicFor) },
                { merge: true }
            )
            updated++
        })
    })
    return { deleted: 0, updated }
}
