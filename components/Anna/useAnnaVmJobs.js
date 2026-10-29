import { useCallback, useEffect, useState } from 'react'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'
import { subscribePageVisible } from '../../utils/appResume'

export const isActiveVmJob = job =>
    ['queued', 'pending', 'initiated', 'awaiting_user', 'cancel_requested'].includes(job.status)

export const vmJobPath = job =>
    `/projects/${job.projectId}/${job.objectType === 'topics' ? 'chats' : 'tasks'}/${job.objectId}/chat`

export default function useAnnaVmJobs(userId, { enabled, selectedRunId }) {
    const [state, setState] = useState({ userId, jobs: [], error: false })
    const [attempt, setAttempt] = useState(0)
    const retry = useCallback(() => setAttempt(value => value + 1), [])
    useEffect(() => {
        if (!enabled || !userId) return
        let disposed = false
        let inFlight = false
        const refresh = async () => {
            if (document.hidden || inFlight) return
            inFlight = true
            try {
                const result = await runHttpsCallableFunction('listActiveVmJobsSecondGen', { selectedRunId })
                if (!disposed) setState({ userId, jobs: result.jobs || [], error: false })
            } catch (error) {
                if (!disposed)
                    setState(previous => ({
                        userId,
                        jobs:
                            previous.userId === userId &&
                            !['permission-denied', 'unauthenticated'].some(code => error.code?.endsWith(code))
                                ? previous.jobs
                                : [],
                        error: true,
                    }))
            } finally {
                inFlight = false
            }
        }
        refresh()
        const timer = setInterval(refresh, 15000)
        const stop = subscribePageVisible(refresh)
        return () => {
            disposed = true
            clearInterval(timer)
            stop()
        }
    }, [userId, enabled, selectedRunId, attempt])
    return {
        jobs: state.userId === userId ? state.jobs.filter(job => isActiveVmJob(job) || job.id === selectedRunId) : [],
        error: state.userId === userId && state.error,
        retry,
    }
}
