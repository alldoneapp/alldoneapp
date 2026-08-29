import store from '../../redux/store'

// Startup work that is not needed to paint the task board (feed badges, sidebar
// counters, My Day mirrors and assistant switch options) should not compete with
// task DISCOVERY across the initial project window. A short fallback here used to
// release dozens of extra listeners as soon as the first (usually empty) project
// answered, several seconds before the project containing the first real task.
// Direct non-task routes still get a bounded fallback.
export const DEFERRED_STARTUP_WORK_FALLBACK_MS = 12000
export const TASK_DATA_SETTLE_GRACE_MS = 1000

const getTaskBoardProjectIds = state => {
    const loadedProjects = Array.isArray(state.loggedUserProjects) ? state.loggedUserProjects : []
    const selectedProjectIndex = state.selectedProjectIndex
    if (Number.isInteger(selectedProjectIndex) && selectedProjectIndex >= 0) {
        const selectedProjectId = loadedProjects[selectedProjectIndex]?.id
        return selectedProjectId ? [selectedProjectId] : []
    }

    const loggedUser = state.loggedUser || {}
    const loadedProjectIds = loadedProjects.map(project => project?.id).filter(Boolean)
    const projectIds = loadedProjectIds.length > 0 ? loadedProjectIds : loggedUser.projectIds || []
    const excludedProjectIds = new Set([
        ...(loggedUser.archivedProjectIds || []),
        ...(loggedUser.templateProjectIds || []),
        ...(loggedUser.guideProjectIds || []),
    ])
    const activeProjectIds = projectIds.filter(projectId => !excludedProjectIds.has(projectId))
    const inFocusTaskProjectId = loggedUser.inFocusTaskProjectId

    return inFocusTaskProjectId && projectIds.includes(inFocusTaskProjectId)
        ? [inFocusTaskProjectId, ...activeProjectIds.filter(projectId => projectId !== inFocusTaskProjectId)]
        : activeProjectIds
}

const projectHasPublishedTaskContent = (state, projectId, userId) => {
    const sections = state.filteredOpenTasksStore?.[`${projectId}${userId}`]
    return Array.isArray(sections) && sections.some(section => Number(section?.[1]) > 0)
}

export const selectInitialTaskDataPublished = state => {
    const userId = state.currentUser?.uid || state.loggedUser?.uid
    if (!userId) return false

    const projectIds = getTaskBoardProjectIds(state)
    if (projectIds.length === 0) return false

    const openReady = state.initialLoadingEndOpenTasks || {}
    const observedReady = state.initialLoadingEndObservedTasks || {}

    // Real task content is enough to release background work: at that point the
    // foreground query has done its job and React only has to commit the rows.
    if (projectIds.some(projectId => projectHasPublishedTaskContent(state, projectId, userId))) return true

    // An empty account has no task row to provide the signal above. Wait until
    // every project in the current task-board scope has answered both independent
    // task streams, rather than treating the first empty assigned-task query as
    // readiness while an observed task could still be on its way.
    return projectIds.every(projectId => {
        const instanceKey = `${projectId}${userId}`
        return !!openReady[instanceKey] && !!observedReady[instanceKey]
    })
}

export const scheduleAfterInitialTaskData = (callback, { fallbackMs = DEFERRED_STARTUP_WORK_FALLBACK_MS } = {}) => {
    let finished = false
    let unsubscribe = null
    let timer = null
    let settleTimer = null

    const finish = () => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        if (settleTimer) clearTimeout(settleTimer)
        if (unsubscribe) unsubscribe()
        callback()
    }
    const check = () => {
        if (selectInitialTaskDataPublished(store.getState()) && !settleTimer) {
            settleTimer = setTimeout(finish, TASK_DATA_SETTLE_GRACE_MS)
        }
    }

    if (typeof store.subscribe === 'function') unsubscribe = store.subscribe(check)
    timer = setTimeout(finish, fallbackMs)
    check()

    return () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        clearTimeout(settleTimer)
        if (unsubscribe) unsubscribe()
    }
}
