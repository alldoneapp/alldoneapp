/**
 * Leaf module for normalizing the several shapes a comment timestamp arrives in
 * (millis, ISO string, Firestore Timestamp, admin-SDK `_seconds` blob).
 *
 * It lives here rather than in ChatHelper because ChatHelper pulls in the redux store,
 * the URL system and the firestore bridge; anything that only needs to read a message's
 * time — the comment popup, the loading-state helpers — should not drag that graph in.
 * ChatHelper re-exports it, so existing call sites are unchanged.
 */
export const getTimestampInMilliseconds = timestamp => {
    if (!timestamp && timestamp !== 0) return undefined
    if (typeof timestamp === 'number') return timestamp
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp)
        return Number.isNaN(parsed) ? undefined : parsed
    }
    if (typeof timestamp?.seconds === 'number') return timestamp.seconds * 1000
    if (typeof timestamp?._seconds === 'number') return timestamp._seconds * 1000
    if (typeof timestamp?.toDate === 'function') {
        const date = timestamp.toDate()
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : undefined
    }
    return undefined
}
