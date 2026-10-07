import { useEffect, useState } from 'react'
import { getDb } from '../../utils/backends/firestore'

const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'incomplete', 'expired'])
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const activityPath = activity => {
    if (
        !activity ||
        ![activity.projectId, activity.objectId, activity.commentId].every(validId) ||
        !['tasks', 'topics'].includes(activity.objectType)
    )
        return null
    return `chatComments/${activity.projectId}/${activity.objectType}/${activity.objectId}/comments/${activity.commentId}`
}

export const browserActivityKey = browser =>
    browser?.runId ? `${browser.runId}/${activityPath(browser.activity) || ''}` : null

export default function useAnnaBrowserCompletion(browser) {
    const key = browserActivityKey(browser)
    const path = activityPath(browser?.activity)
    const [completed, setCompleted] = useState(null)
    useEffect(() => {
        if (!path) return
        let stopped = false
        const stop = getDb()
            .doc(path)
            .onSnapshot(
                snapshot => {
                    if (!stopped) setCompleted(terminal.has(snapshot.data()?.assistantRun?.status) ? key : null)
                },
                () => {
                    if (!stopped) setCompleted(null)
                }
            )
        return () => {
            stopped = true
            stop()
        }
    }, [key, path])
    return !!key && completed === key
}
