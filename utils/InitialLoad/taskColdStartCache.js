import moment from 'moment'

/**
 * A compact stale-while-revalidate projection of the task board.
 *
 * Firestore already persists canonical task documents in IndexedDB. Rebuilding the visible board
 * from that cache is still expensive, though: All Projects has to attach one query per project and
 * Chrome serializes a large part of that work through Firestore's own IndexedDB transactions.
 * This second cache stores only the Redux data needed to paint the previous task rows and their
 * lightweight project decorations. The normal listeners remain authoritative and replace the
 * projection as soon as their first snapshots land.
 */

export const TASK_COLD_START_CACHE_SCHEMA_VERSION = 2
export const TASK_COLD_START_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000
export const TASK_COLD_START_CACHE_WRITE_DELAY_MS = 1200

const DATABASE_NAME = 'alldone-task-cold-start'
const DATABASE_VERSION = 1
const SNAPSHOT_STORE = 'snapshots'

let pendingWriteTimer = null
let pendingIdleHandle = null

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)

export const getTaskColdStartDayKey = (timestamp = Date.now()) => moment(timestamp).format('YYYY-MM-DD')

export const getTaskColdStartProjectIds = (loadedProjects, loggedUser = {}) => {
    const loadedProjectIds = (Array.isArray(loadedProjects) ? loadedProjects : [])
        .map(project => project?.id)
        .filter(Boolean)
    const excludedProjectIds = new Set([
        ...(loggedUser.archivedProjectIds || []),
        ...(loggedUser.templateProjectIds || []),
        ...(loggedUser.guideProjectIds || []),
    ])
    const activeProjectIds = loadedProjectIds.filter(projectId => !excludedProjectIds.has(projectId))
    const inFocusTaskProjectId = loggedUser.inFocusTaskProjectId

    return inFocusTaskProjectId && loadedProjectIds.includes(inFocusTaskProjectId)
        ? [inFocusTaskProjectId, ...activeProjectIds.filter(projectId => projectId !== inFocusTaskProjectId)]
        : activeProjectIds
}

const projectSnapshotHasTaskContent = projectSnapshot =>
    projectSnapshot.openTasks.some(section => Number(section?.[1]) > 0)

const projectSnapshotHasRenderMetadata = projectSnapshot =>
    Array.isArray(projectSnapshot.openMilestones) &&
    Array.isArray(projectSnapshot.doneMilestones) &&
    projectSnapshot.goalsById &&
    typeof projectSnapshot.goalsById === 'object'

const getIndexedDbFactory = () => {
    if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB
    if (typeof indexedDB !== 'undefined') return indexedDB
    return null
}

const openCacheDatabase = factory =>
    new Promise((resolve, reject) => {
        const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
        request.onupgradeneeded = () => {
            const database = request.result
            if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
                database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'userId' })
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error('Could not open the task cold-start cache'))
        request.onblocked = () => reject(new Error('Task cold-start cache upgrade was blocked'))
    })

export const readTaskColdStartCache = async userId => {
    const factory = getIndexedDbFactory()
    if (!factory || !userId) return null

    let database
    try {
        database = await openCacheDatabase(factory)
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction(SNAPSHOT_STORE, 'readonly')
            const request = transaction.objectStore(SNAPSHOT_STORE).get(userId)
            request.onsuccess = () => resolve(request.result || null)
            request.onerror = () => reject(request.error || new Error('Could not read the task cold-start cache'))
        })
    } catch (error) {
        if (__DEV__) console.warn('[TaskColdStartCache] Read failed:', error)
        return null
    } finally {
        database?.close()
    }
}

export const writeTaskColdStartCache = async snapshot => {
    const factory = getIndexedDbFactory()
    if (!factory || !snapshot?.userId) return false

    let database
    try {
        database = await openCacheDatabase(factory)
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(SNAPSHOT_STORE, 'readwrite')
            transaction.objectStore(SNAPSHOT_STORE).put(snapshot)
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error || new Error('Could not write task cold-start cache'))
            transaction.onabort = () => reject(transaction.error || new Error('Task cold-start cache write aborted'))
        })
        return true
    } catch (error) {
        if (__DEV__) console.warn('[TaskColdStartCache] Write failed:', error)
        return false
    } finally {
        database?.close()
    }
}

export const buildTaskColdStartSnapshot = (state, savedAt = Date.now()) => {
    const userId = state?.loggedUser?.uid
    const currentUserId = state?.currentUser?.uid
    if (!userId || currentUserId !== userId) return null

    const projects = {}
    const loadedProjects = Array.isArray(state.loggedUserProjects) ? state.loggedUserProjects : []
    loadedProjects.forEach(project => {
        const projectId = project?.id
        const instanceKey = `${projectId}${currentUserId}`
        if (!projectId || !hasOwn(state.openTasksStore, instanceKey)) return

        projects[projectId] = {
            openTasks: state.openTasksStore[instanceKey],
            subtaskByTask: state.subtaskByTaskStore?.[instanceKey] || {},
            openTasksMap: state.openTasksMap?.[projectId] || {},
            openSubtasksMap: state.openSubtasksMap?.[projectId] || {},
            // MainSection cannot order goal-backed task groups until these three live snapshots
            // arrive. Keeping the same render metadata as the previous session lets cached rows
            // paint immediately; the normal listeners remain authoritative and replace it.
            openMilestones: state.openMilestonesByProjectInTasks?.[projectId],
            doneMilestones: state.doneMilestonesByProjectInTasks?.[projectId],
            goalsById: state.goalsByProjectInTasks?.[projectId],
            // Optional and additive: retaining schema 2 keeps every existing task projection
            // usable after this rollout. Once the late OKR watcher publishes, it schedules a new
            // write containing this user-filtered render array for the next cold start.
            ...(Array.isArray(state.okrsByProjectInTasks?.[projectId])
                ? { okrs: state.okrsByProjectInTasks[projectId] }
                : {}),
            thereAreNotTasksInFirstDay: !!state.thereAreNotTasksInFirstDay?.[instanceKey],
            thereAreHiddenNotMainTasks: !!state.thereAreHiddenNotMainTasks?.[instanceKey],
        }
    })

    if (Object.keys(projects).length === 0) return null

    const projectIds = getTaskColdStartProjectIds(loadedProjects, state.loggedUser)
    const hasCompleteEmptyTodayProjection =
        projectIds.length > 0 &&
        state.openTasksAmountLoaded === true &&
        Number(state.openTasksAmount) === 0 &&
        Number(state.todayEmptyGoalsTotalAmountInOpenTasksView?.total || 0) === 0 &&
        projectIds.every(projectId => {
            const instanceKey = `${projectId}${currentUserId}`
            const projectSnapshot = projects[projectId]
            return (
                projectSnapshot &&
                projectSnapshotHasRenderMetadata(projectSnapshot) &&
                !!state.initialLoadingEndOpenTasks?.[instanceKey] &&
                !!state.initialLoadingEndObservedTasks?.[instanceKey] &&
                !!state.thereAreNotTasksInFirstDay?.[instanceKey]
            )
        })

    return {
        schemaVersion: TASK_COLD_START_CACHE_SCHEMA_VERSION,
        userId,
        currentUserId,
        savedAt,
        projects,
        // Empty is meaningful only for the same local calendar day and only after every active
        // project, both task streams, the count queries and the goal decorations have answered.
        // This lets the next cold start paint inbox-zero immediately without turning an incomplete
        // cache into a false celebration.
        emptyToday: hasCompleteEmptyTodayProjection
            ? {
                  userId,
                  dayKey: getTaskColdStartDayKey(savedAt),
                  projectIds,
              }
            : null,
    }
}

export const getRestorableTaskColdStartSnapshot = (
    snapshot,
    userId,
    allowedProjectIds,
    now = Date.now(),
    taskBoardProjectIds = allowedProjectIds
) => {
    if (
        !snapshot ||
        snapshot.schemaVersion !== TASK_COLD_START_CACHE_SCHEMA_VERSION ||
        snapshot.userId !== userId ||
        snapshot.currentUserId !== userId ||
        !Number.isFinite(snapshot.savedAt) ||
        snapshot.savedAt > now + 5 * 60 * 1000 ||
        now - snapshot.savedAt > TASK_COLD_START_CACHE_MAX_AGE_MS
    ) {
        return null
    }

    const allowedIds = new Set(Array.isArray(allowedProjectIds) ? allowedProjectIds : [])
    const projects = {}
    Object.entries(snapshot.projects || {}).forEach(([projectId, projectSnapshot]) => {
        if (!allowedIds.has(projectId) || !Array.isArray(projectSnapshot?.openTasks)) return
        // A task-bearing projection without its goal-order metadata would hydrate successfully but
        // MainSection still could not paint it. Ignore that partial project and let the broad live
        // discovery path handle it instead of throttling startup around an unusable cache hint.
        if (projectSnapshotHasTaskContent(projectSnapshot) && !projectSnapshotHasRenderMetadata(projectSnapshot)) return
        projects[projectId] = projectSnapshot
    })

    if (Object.keys(projects).length === 0) return null

    const emptyTodayProjectIds = Array.isArray(snapshot.emptyToday?.projectIds) ? snapshot.emptyToday.projectIds : []
    const emptyTodayProjectIdsSet = new Set(emptyTodayProjectIds)
    const taskBoardProjectIdsSet = new Set(Array.isArray(taskBoardProjectIds) ? taskBoardProjectIds : [])
    const hasRestorableEmptyToday =
        snapshot.emptyToday?.userId === userId &&
        snapshot.emptyToday?.dayKey === getTaskColdStartDayKey(now) &&
        emptyTodayProjectIds.length === taskBoardProjectIdsSet.size &&
        [...taskBoardProjectIdsSet].every(projectId => emptyTodayProjectIdsSet.has(projectId) && projects[projectId])

    return {
        ...snapshot,
        projects,
        emptyToday: hasRestorableEmptyToday ? snapshot.emptyToday : null,
    }
}

export const getTaskBearingProjectIndexes = (projectIds, openTasksStore, currentUserId) => {
    if (!currentUserId) return []
    return projectIds.reduce((indexes, projectId, index) => {
        const sections = openTasksStore?.[`${projectId}${currentUserId}`]
        if (Array.isArray(sections) && sections.some(section => Number(section?.[1]) > 0)) indexes.push(index)
        return indexes
    }, [])
}

const cancelPendingIdleWrite = () => {
    if (pendingIdleHandle === null) return
    if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(pendingIdleHandle)
    } else {
        clearTimeout(pendingIdleHandle)
    }
    pendingIdleHandle = null
}

const runWhenIdle = callback => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        pendingIdleHandle = window.requestIdleCallback(callback, { timeout: 4000 })
    } else {
        pendingIdleHandle = setTimeout(callback, 0)
    }
}

export const scheduleTaskColdStartCachePersist = (
    getState,
    { delayMs = TASK_COLD_START_CACHE_WRITE_DELAY_MS, writeSnapshot = writeTaskColdStartCache } = {}
) => {
    clearTimeout(pendingWriteTimer)
    cancelPendingIdleWrite()

    pendingWriteTimer = setTimeout(() => {
        pendingWriteTimer = null
        runWhenIdle(() => {
            pendingIdleHandle = null
            const snapshot = buildTaskColdStartSnapshot(getState())
            if (snapshot) writeSnapshot(snapshot)
        })
    }, delayMs)
}
