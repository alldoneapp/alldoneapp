'use strict'

// Resolving a Gmail label means scanning as many as 1,000 inbox threads and 1,000
// label threads. Keep the resulting membership briefly so modal reopen and pagination
// can reuse it. This module intentionally has no provider dependencies: mutation paths
// such as Gmail feedback can invalidate it without loading googleapis.
const RESOLVED_THREAD_IDS_TTL_MS = 60 * 1000
const resolvedThreadIdsCache = new Map()

function cacheKey(userId, projectId, labelId) {
    return `${userId}:${projectId}:${labelId}`
}

function getCachedResolvedThreadIds(userId, projectId, labelId) {
    const key = cacheKey(userId, projectId, labelId)
    const cached = resolvedThreadIdsCache.get(key)
    if (!cached) return null
    if (Date.now() - cached.cachedAt >= RESOLVED_THREAD_IDS_TTL_MS) {
        resolvedThreadIdsCache.delete(key)
        return null
    }
    return cached.threadIds
}

function cacheResolvedThreadIds(userId, projectId, labelId, threadIds) {
    resolvedThreadIdsCache.set(cacheKey(userId, projectId, labelId), {
        threadIds,
        cachedAt: Date.now(),
    })
}

function invalidateResolvedThreadIds(userId, projectId) {
    const prefix = `${userId}:${projectId}:`
    for (const key of resolvedThreadIdsCache.keys()) {
        if (key.startsWith(prefix)) resolvedThreadIdsCache.delete(key)
    }
}

module.exports = {
    getCachedResolvedThreadIds,
    cacheResolvedThreadIds,
    invalidateResolvedThreadIds,
}
