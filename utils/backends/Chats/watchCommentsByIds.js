import firebase from 'firebase/compat/app'

import { getDb, globalWatcherUnsub } from '../firestore'

// Firestore accepts at most 30 values in one `in` filter.
export const COMMENTS_BY_ID_QUERY_CHUNK_SIZE = 30

export const chunkIds = (ids, size = COMMENTS_BY_ID_QUERY_CHUNK_SIZE) => {
    const chunks = []
    for (let index = 0; index < (ids || []).length; index += size) chunks.push(ids.slice(index, index + size))
    return chunks
}

/**
 * Listens to exactly these comments of one chat, by document id (AT-3149).
 *
 * The unread list and the unread previews used to read "the newest N + 5 comments" of the chat and
 * keep the unread ones. In a "Daily emails" topic most newer emails get read or archived (Gmail
 * read sync, auto-archive) while an older one stays unread, so that older comment fell outside the
 * window: "Unread 2" on the chip, one row in the list. Reading the unread comments by id cannot
 * miss one, whatever its position in the thread.
 *
 * `callback(comments)` fires once every chunk has delivered its first snapshot, and again on every
 * later change. A chunk whose query fails counts as empty, so the caller is never left "loading".
 */
export function watchCommentsByIds(projectId, chatType, chatId, commentIds, watcherKey, callback, options = {}) {
    const collection = getDb().collection(`chatComments/${projectId}/${chatType}/${chatId}/comments`)
    const chunks = chunkIds(commentIds)
    const results = chunks.map(() => null)
    let active = true

    const deliver = () => {
        if (active && results.every(Boolean)) callback(results.flat())
    }

    const unsubscribers = chunks.map((ids, index) =>
        collection.where(firebase.firestore.FieldPath.documentId(), 'in', ids).onSnapshot(
            snapshot => {
                const comments = []
                snapshot.forEach(doc => {
                    comments.push({ ...doc.data(), id: doc.id })
                })
                results[index] = comments
                deliver()
            },
            error => {
                if (options.onError) options.onError(error)
                results[index] = []
                deliver()
            }
        )
    )

    if (chunks.length === 0) callback([])

    globalWatcherUnsub[watcherKey] = () => {
        active = false
        unsubscribers.forEach(unsubscribe => unsubscribe())
    }
}
