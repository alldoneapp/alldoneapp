import store from './store'

/**
 * In-memory stand-in for applyDailyPlanSecondGen + the plan record + the undo record. It applies
 * the decisions to the fixture's openTasksMap the way the server writes them (postponed tasks
 * leave Today, planned tasks get their priority, kept Must/Should/Could become Do later) so the
 * Today pill and the filter can be checked after Apply and after Undo.
 */
let plan = null
let status = null
let before = null
const planListeners = new Set()
const statusListeners = new Set()
const notify = () => {
    planListeners.forEach(listener => listener(plan))
    statusListeners.forEach(listener => listener(status))
}
window.__applyCalls = []
window.__undoCalls = 0

export const getLocalPlanDateKey = () => 'harness-day'

export const applyDailyPlan = async tasks => {
    window.__applyCalls.push(tasks)
    const map = store.getState().openTasksMap
    before = map
    const next = {}
    Object.keys(map).forEach(projectId => {
        next[projectId] = { ...map[projectId] }
    })
    tasks.forEach(item => {
        const task = next[item.projectId][item.taskId]
        if (item.decision === 'postpone') delete next[item.projectId][item.taskId]
        else if (item.decision === 'plan') next[item.projectId][item.taskId] = { ...task, priority: item.priority }
        else if (['must_do', 'should_do', 'could_do'].includes(task.priority))
            next[item.projectId][item.taskId] = { ...task, priority: 'do_later' }
    })
    store.dispatch({ type: 'harness/openTasksMap', openTasksMap: next })
    const planned = tasks
        .filter(item => item.decision === 'plan')
        .map(item => ({
            key: `${item.projectId}:${item.taskId}`,
            projectId: item.projectId,
            priority: item.priority,
            minutes: item.estimateMinutes,
        }))
    plan = { actionId: 'action-1', planned, plannedMinutes: planned.reduce((total, item) => total + item.minutes, 0) }
    status = 'applied'
    setTimeout(notify, 50)
    return { success: true, actionId: 'action-1', skipped: [], plannedCount: planned.length }
}

export const watchDailyPlan = (userId, dateKey, callback) => {
    planListeners.add(callback)
    callback(plan)
    return () => planListeners.delete(callback)
}

export const watchDailyPlanUndoStatus = (userId, actionId, callback) => {
    statusListeners.add(callback)
    callback(status)
    return () => statusListeners.delete(callback)
}

export const undoDailyPlan = async () => {
    window.__undoCalls++
    store.dispatch({ type: 'harness/openTasksMap', openTasksMap: before })
    status = 'undone'
    setTimeout(notify, 20)
    return { success: true, status: 'undone', skippedOperationCount: 0 }
}
