import store from '../../redux/store'

// Startup work that is not needed to paint the task board (feed badges, sidebar
// counters, My Day mirrors and assistant switch options) should not compete with
// the first task listeners. The fallback keeps direct non-task routes complete.
export const DEFERRED_STARTUP_WORK_FALLBACK_MS = 4000

export const selectInitialTaskDataPublished = state => {
    const userId = state.currentUser?.uid || state.loggedUser?.uid
    if (!userId) return false

    const loadedProjectIds = Array.isArray(state.loggedUserProjects)
        ? state.loggedUserProjects.map(project => project?.id).filter(Boolean)
        : []
    const projectIds =
        loadedProjectIds.length > 0
            ? loadedProjectIds
            : Array.isArray(state.loggedUser?.projectIds)
              ? state.loggedUser.projectIds
              : []
    const openReady = state.initialLoadingEndOpenTasks || {}
    const observedReady = state.initialLoadingEndObservedTasks || {}

    return projectIds.some(projectId => {
        const instanceKey = `${projectId}${userId}`
        return !!openReady[instanceKey] || !!observedReady[instanceKey]
    })
}

export const scheduleAfterInitialTaskData = (callback, { fallbackMs = DEFERRED_STARTUP_WORK_FALLBACK_MS } = {}) => {
    let finished = false
    let unsubscribe = null
    let timer = null

    const finish = () => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        if (unsubscribe) unsubscribe()
        callback()
    }
    const check = () => {
        if (selectInitialTaskDataPublished(store.getState())) finish()
    }

    if (typeof store.subscribe === 'function') unsubscribe = store.subscribe(check)
    timer = setTimeout(finish, fallbackMs)
    check()

    return () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        if (unsubscribe) unsubscribe()
    }
}
