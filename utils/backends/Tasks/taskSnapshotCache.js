/**
 * Returns the task snapshot already driving the visible task list, when available.
 *
 * Postponing a task with subtasks records every subtask's previous date for undo. The Firestore
 * cache is a useful fallback, but asking IndexedDB first is still asynchronous and a cache miss
 * becomes a network read before the visible task write can even start. These Redux maps are fed by
 * the same task listeners (and restored by the cold-start cache), so use them before touching the
 * SDK cache.
 */
export const getTaskFromLoadedTaskMaps = (state, projectId, taskId) => {
    if (!state || !projectId || !taskId) return null

    const openSubtask = state.openSubtasksMap?.[projectId]?.[taskId]
    if (openSubtask) return openSubtask

    return state.openTasksMap?.[projectId]?.[taskId] || null
}
