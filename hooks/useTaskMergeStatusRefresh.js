import { useEffect } from 'react'

import { refreshTaskMergeStatus } from '../utils/backends/firestore'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const recentRefreshes = new Map()

export default function useTaskMergeStatusRefresh(projectId, task) {
    const mergeRequest = task?.vmMergeRequest
    const taskId = task?.id

    useEffect(() => {
        if (!projectId || !taskId || !mergeRequest?.url || mergeRequest.status === 'merged') return

        const now = Date.now()
        const statusAge = now - Number(mergeRequest.statusUpdatedAt || 0)
        const key = `${projectId}/${taskId}`
        const lastRequestedAt = recentRefreshes.get(key) || 0
        if (statusAge >= 0 && statusAge < REFRESH_INTERVAL_MS) return
        if (now - lastRequestedAt < REFRESH_INTERVAL_MS) return

        recentRefreshes.set(key, now)
        refreshTaskMergeStatus({ projectId, taskId }).catch(() => {
            // Allow a later mount to retry transient provider/network failures.
            recentRefreshes.delete(key)
        })
    }, [projectId, taskId, mergeRequest?.url, mergeRequest?.status, mergeRequest?.statusUpdatedAt])
}
