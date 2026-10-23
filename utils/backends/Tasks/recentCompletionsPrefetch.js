import moment from 'moment'

import store from '../../../redux/store'
import { getDb } from '../firestore'
import { isBrowserOffline } from '../../connectionState'
import { RESUME_INTEGRITY_MS, subscribePageVisible } from '../../appResume'
import { getTaskColdStartProjectIds } from '../../InitialLoad/taskColdStartCache'
import { startPerformanceTrace } from '../../performance/performanceLogger'
import { beginOpenTasksServerSyncCycle } from '../../performance/openTasksServerSync'

/**
 * Tell the open-task board about tasks that were completed on ANOTHER device while this one was
 * away, before the board's own listeners get round to it.
 *
 * Why the board cannot work this out quickly by itself: Firestore can only resume a listener with
 * a delta for about 30 minutes. After a longer absence every open-task query re-runs from scratch,
 * and a task finished elsewhere is still `inDone: false` in this device's IndexedDB cache, so it
 * still matches "open, mine, due today" locally. The SDK will not drop it until it has fetched
 * that one document again (limbo resolution), and the app's own staged startup admits the complete
 * per-project listeners - the only ones allowed to remove retained rows - two at a time. After a
 * productive day the phone therefore showed tasks that were long done for most of a minute.
 *
 * One small server query per active project fixes the cause rather than the symptom: it returns
 * exactly the tasks completed since this device last synced (reads billed = tasks completed), and
 * writing them into the cache flips them to done for every listener at once, attached or not, with
 * no per-document limbo lookups. The results are also published to the open-task watchers so rows
 * they retained from an earlier listener or from the cold-start projection leave immediately (see
 * `watchUserOpenTasks`).
 *
 * The query reuses the Done tab's show-more index (readerIds CONTAINS, inDone, userId, completed),
 * so no index has to be deployed. Every failure path is silent: this is an accelerator, the normal
 * listeners still converge on their own.
 */
export const RECENT_COMPLETIONS_MAX_LOOKBACK_MS = 48 * 60 * 60 * 1000
export const RECENT_COMPLETIONS_PROJECT_CONCURRENCY = 4
export const RECENT_COMPLETIONS_PER_PROJECT_LIMIT = 500
/** Published results older than this are ignored by listeners that attach later. */
export const RECENT_COMPLETIONS_RESULT_TTL_MS = 10 * 60 * 1000
/** A resume shorter than this keeps its Firestore delta and needs no prefetch. */
export const RECENT_COMPLETIONS_RESUME_AFTER_MS = RESUME_INTEGRITY_MS

// projectId -> { userId, fetchedAt, tasks: [{ id, data }] }
let resultsByProject = {}
// projectId -> Set<listener>
let listenersByProject = {}
let runGeneration = 0
let resumeUnsubscribe = null
let lastVisibleAt = Date.now()

/**
 * The tasks completed since this moment are fetched. Normally the start of today; earlier when
 * this device last synced before today (overnight absence), but never more than 48 hours back.
 */
export const getRecentCompletionsSince = ({ now = Date.now(), lastSyncedAt = null } = {}) => {
    const startOfToday = moment(now).startOf('day').valueOf()
    const lowerBound = now - RECENT_COMPLETIONS_MAX_LOOKBACK_MS
    const since = Number.isFinite(lastSyncedAt) ? Math.min(startOfToday, lastSyncedAt) : startOfToday
    return Math.max(lowerBound, since)
}

export const getRecentlyCompletedTasks = (projectId, userId, now = Date.now()) => {
    const result = resultsByProject[projectId]
    if (!result || result.userId !== userId || now - result.fetchedAt > RECENT_COMPLETIONS_RESULT_TTL_MS) return []
    return result.tasks
}

export const subscribeToRecentCompletions = (projectId, listener) => {
    if (!projectId || typeof listener !== 'function') return () => {}
    if (!listenersByProject[projectId]) listenersByProject[projectId] = new Set()
    listenersByProject[projectId].add(listener)
    return () => {
        const listeners = listenersByProject[projectId]
        if (!listeners) return
        listeners.delete(listener)
        if (listeners.size === 0) delete listenersByProject[projectId]
    }
}

const publish = (projectId, result) => {
    resultsByProject[projectId] = result
    const listeners = listenersByProject[projectId]
    if (!listeners) return
    ;[...listeners].forEach(listener => {
        try {
            listener(result.tasks)
        } catch (error) {
            console.warn('[RecentCompletions] Listener failed:', error)
        }
    })
}

const fetchProjectCompletions = (projectId, userId, readerId, since) =>
    getDb()
        .collection(`items/${projectId}/tasks`)
        .where('inDone', '==', true)
        .where('userId', '==', userId)
        .where('readerIds', 'array-contains', readerId)
        .where('completed', '>=', since)
        .limit(RECENT_COMPLETIONS_PER_PROJECT_LIMIT)
        .get({ source: 'server' })

/**
 * Fetch and publish the recent completions of the given projects. Resolves with a summary and
 * never rejects. A newer run supersedes an older one: the older run stops publishing.
 */
export const prefetchRecentCompletions = async ({ projectIds, userId, readerId, since, reason = 'manual' }) => {
    const ids = Array.isArray(projectIds) ? projectIds.filter(Boolean) : []
    if (!userId || !readerId || ids.length === 0 || !Number.isFinite(since)) {
        return { skipped: 'no_scope', projectCount: 0, taskCount: 0, errorCount: 0 }
    }
    if (isBrowserOffline()) return { skipped: 'offline', projectCount: 0, taskCount: 0, errorCount: 0 }

    const generation = ++runGeneration
    // Results of an earlier run describe an earlier moment; a listener attaching while this run is
    // in flight must not act on them.
    resultsByProject = {}
    const trace = startPerformanceTrace('completed_tasks_prefetch', { source: reason })
    let taskCount = 0
    let errorCount = 0
    let nextIndex = 0

    const worker = async () => {
        while (nextIndex < ids.length) {
            const projectId = ids[nextIndex++]
            try {
                const snapshot = await fetchProjectCompletions(projectId, userId, readerId, since)
                if (generation !== runGeneration) return
                const tasks = snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }))
                taskCount += tasks.length
                publish(projectId, { userId, fetchedAt: Date.now(), tasks })
            } catch (error) {
                errorCount += 1
            }
        }
    }

    const workerCount = Math.min(RECENT_COMPLETIONS_PROJECT_CONCURRENCY, ids.length)
    await Promise.all(Array.from({ length: workerCount }, worker))

    const summary = { projectCount: ids.length, taskCount, errorCount }
    if (generation !== runGeneration) {
        trace.end('superseded', { outcome: 'cancelled', project_count: ids.length })
        return { ...summary, skipped: 'superseded' }
    }
    if (errorCount > 0) console.warn('[RecentCompletions] Some projects could not be prefetched', summary)
    trace.end('complete', {
        outcome: errorCount === ids.length ? 'failed' : 'success',
        project_count: ids.length,
        task_count: taskCount,
        error_count: errorCount,
    })
    return summary
}

// Never throws: both callers sit on paths (login, resume) that must not fail because an
// accelerator did.
const prefetchForLoggedUser = ({ reason, lastSyncedAt, projectIds = null }) => {
    try {
        const { loggedUser, currentUser, loggedUserProjects } = store.getState()
        if (!loggedUser?.uid || loggedUser.isAnonymous) return Promise.resolve(null)
        return prefetchRecentCompletions({
            projectIds: projectIds || getTaskColdStartProjectIds(loggedUserProjects, loggedUser),
            userId: currentUser?.uid || loggedUser.uid,
            readerId: loggedUser.uid,
            since: getRecentCompletionsSince({ lastSyncedAt }),
            reason,
        })
    } catch (error) {
        console.warn('[RecentCompletions] Prefetch could not start:', error)
        return Promise.resolve(null)
    }
}

/**
 * Cold start: called once the project list is loaded, with the task-board project ids the loader
 * already resolved and the time the cold-start task snapshot was saved (the last moment this
 * device is known to have had a current board), when there is one.
 */
export const startRecentCompletionsPrefetchOnBoot = ({ projectIds = null, lastSyncedAt = null } = {}) => {
    beginOpenTasksServerSyncCycle('boot')
    installRecentCompletionsResumePrefetch()
    return prefetchForLoggedUser({ reason: 'boot', lastSyncedAt, projectIds })
}

/**
 * Resume: the open-task watchers are rebuilt after the same absence
 * (`usePageVisibleRefreshGeneration`), so the prefetch runs alongside that rebuild. `hiddenMs` can
 * be null when Android delivered no absence signal; the time since the last visible return is the
 * fallback, exactly as the watcher rebuild does it.
 */
export const installRecentCompletionsResumePrefetch = () => {
    if (resumeUnsubscribe) return resumeUnsubscribe
    lastVisibleAt = Date.now()
    resumeUnsubscribe = subscribePageVisible(({ hiddenMs } = {}) => {
        const visibleAt = Date.now()
        const absenceMs = Number.isFinite(hiddenMs) ? hiddenMs : visibleAt - lastVisibleAt
        lastVisibleAt = visibleAt
        if (absenceMs < RECENT_COMPLETIONS_RESUME_AFTER_MS) return
        beginOpenTasksServerSyncCycle('resume')
        prefetchForLoggedUser({ reason: 'resume', lastSyncedAt: visibleAt - absenceMs })
    })
    return resumeUnsubscribe
}

// Test-only reset of the module state.
export const __resetRecentCompletionsPrefetchForTests = () => {
    resultsByProject = {}
    listenersByProject = {}
    runGeneration = 0
    if (resumeUnsubscribe) resumeUnsubscribe()
    resumeUnsubscribe = null
    lastVisibleAt = Date.now()
}
