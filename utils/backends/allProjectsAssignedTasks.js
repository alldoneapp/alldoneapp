import { getDb } from './firestore'
import { createCachedSnapshotGate } from './cachedSnapshotGate'
import { createFirstSnapshotPerformance } from '../performance/firestoreSnapshotPerformance'

const sharedWatches = new Map()
export const MAX_PROJECT_IDS_PER_ASSIGNED_TASK_QUERY = 30

export const normalizeAssignedTaskProjectIds = projectIds =>
    Array.from(
        new Set((Array.isArray(projectIds) ? projectIds : []).filter(projectId => typeof projectId === 'string'))
    )
        .filter(Boolean)
        .sort()

const getTaskProjectId = taskDocument => {
    const pathSegments = taskDocument?.ref?.path?.split('/').filter(Boolean) || []
    if (
        pathSegments.length < 4 ||
        pathSegments[pathSegments.length - 4] !== 'items' ||
        pathSegments[pathSegments.length - 2] !== 'tasks'
    ) {
        return null
    }
    return pathSegments[pathSegments.length - 3]
}

const getProjectDocuments = (snapshot, projectId) =>
    (snapshot?.docs || []).filter(taskDocument => getTaskProjectId(taskDocument) === projectId)

const createProjectSnapshot = (snapshot, projectId, changes, { replay = false } = {}) => {
    const docs = getProjectDocuments(snapshot, projectId)
    const projectChanges = replay
        ? docs.map((doc, newIndex) => ({ type: 'added', doc, oldIndex: -1, newIndex }))
        : changes.filter(change => getTaskProjectId(change.doc) === projectId)

    return {
        docs,
        size: docs.length,
        empty: docs.length === 0,
        forEach: callback => docs.forEach(callback),
        docChanges: () => projectChanges,
        metadata: snapshot.metadata,
    }
}

export const getAllProjectsAssignedTasksQuery = ({ currentUserId, accessReaderId, endOfDay, projectIds }) => {
    const normalizedProjectIds = normalizeAssignedTaskProjectIds(projectIds)
    if (normalizedProjectIds.length === 0 || normalizedProjectIds.length > MAX_PROJECT_IDS_PER_ASSIGNED_TASK_QUERY) {
        throw new Error('The shared assigned-task query requires between 1 and 30 active project ids')
    }

    return getDb()
        .collectionGroup('tasks')
        .where('readerIds', 'array-contains', accessReaderId)
        .where('projectId', 'in', normalizedProjectIds)
        .where('currentReviewerId', '==', currentUserId)
        .where('inDone', '==', false)
        .where('dueDate', '<=', endOfDay)
}

const getSharedWatchKey = ({ currentUserId, accessReaderId, endOfDay, projectIds }) =>
    `${currentUserId}\u001f${accessReaderId}\u001f${endOfDay}\u001f${normalizeAssignedTaskProjectIds(projectIds).join('\u001e')}`

const createSharedWatch = ({ currentUserId, accessReaderId, endOfDay, projectIds, trackConnectionHealth }) => {
    const key = getSharedWatchKey({ currentUserId, accessReaderId, endOfDay, projectIds })
    const subscribers = new Map()
    const snapshotPerformance = createFirstSnapshotPerformance(
        {
            object_type: 'tasks',
            scope: 'all_projects',
            source: 'assigned_open_tasks_all_projects',
        },
        { sampleRate: 0.02 }
    )
    let cacheChanges = []
    let latestSnapshot = null
    let closed = false
    let started = false
    let gate = null
    let unsubscribeQuery = null

    const watch = {
        key,
        subscribers,
        subscribe(projectId, onSnapshot, onError) {
            const subscriberId = Symbol(projectId)
            subscribers.set(subscriberId, { projectId, onSnapshot, onError })
            watch.start()

            if (latestSnapshot) {
                Promise.resolve().then(() => {
                    if (!closed && subscribers.has(subscriberId)) {
                        onSnapshot(createProjectSnapshot(latestSnapshot, projectId, [], { replay: true }))
                    }
                })
            }

            return () => {
                subscribers.delete(subscriberId)
                if (subscribers.size === 0) watch.close()
            }
        },
        start() {
            if (started || closed) return
            started = true
            gate = createCachedSnapshotGate(() => handleSnapshot, { trackConnectionHealth })
            try {
                const query = getAllProjectsAssignedTasksQuery({ currentUserId, accessReaderId, endOfDay, projectIds })
                unsubscribeQuery = gate.wrapUnsubscribe(
                    query.onSnapshot({ includeMetadataChanges: true }, handleSnapshot, handleError)
                )
            } catch (error) {
                handleError(error)
            }
        },
        close() {
            if (closed) return
            closed = true
            if (unsubscribeQuery) unsubscribeQuery()
            else gate?.dispose()
            snapshotPerformance.cancel()
            if (sharedWatches.get(key) === watch) sharedWatches.delete(key)
            subscribers.clear()
            latestSnapshot = null
            cacheChanges = []
        },
    }

    function handleSnapshot(snapshot) {
        if (closed) return
        const changes = snapshot.docChanges()
        const buffered = gate.shouldBuffer(snapshot)
        snapshotPerformance.observe(snapshot, buffered)
        if (buffered) {
            cacheChanges = [...cacheChanges, ...changes]
            return
        }

        const mergedChanges = [...cacheChanges, ...changes]
        cacheChanges = []
        latestSnapshot = snapshot
        subscribers.forEach(({ projectId, onSnapshot }) => {
            onSnapshot(createProjectSnapshot(snapshot, projectId, mergedChanges))
        })
    }

    const handleError = () => {
        if (closed) return
        snapshotPerformance.fail()
        const currentSubscribers = [...subscribers.values()]
        watch.close()
        currentSubscribers.forEach(({ onError }) => onError?.())
    }

    return watch
}

export const subscribeToAllProjectsAssignedTasks = ({
    projectId,
    currentUserId,
    accessReaderId,
    endOfDay,
    projectIds,
    trackConnectionHealth = false,
    onSnapshot,
    onError,
}) => {
    const key = getSharedWatchKey({ currentUserId, accessReaderId, endOfDay, projectIds })
    let watch = sharedWatches.get(key)
    if (!watch) {
        watch = createSharedWatch({ currentUserId, accessReaderId, endOfDay, projectIds, trackConnectionHealth })
        sharedWatches.set(key, watch)
    }
    return watch.subscribe(projectId, onSnapshot, onError)
}

export const resetAllProjectsAssignedTaskWatchesForTests = () => {
    ;[...sharedWatches.values()].forEach(watch => watch.close())
    sharedWatches.clear()
}
