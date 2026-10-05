import moment from 'moment'

// A display overlay only: Firestore and its undo record remain server-owned.
// Entries are scoped to one actor/project and only to tasks already loaded at selection time.
const entries = new Map()
const listeners = new Set()
export const PROJECT_POSTPONE_ECHO_TIMEOUT_MS = 15000
export const projectPostponeKey = (projectId, userId) => JSON.stringify([projectId, userId])
const notify = () => listeners.forEach(listener => listener())
export const subscribeProjectPostpone = listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
export const getProjectPostpone = (projectId, userId) => entries.get(projectPostponeKey(projectId, userId))

export const isProjectPostponeEligible = (task, userId, endOfToday) =>
    task.currentReviewerId === userId &&
    task.inDone === false &&
    task.done !== true &&
    Number.isFinite(task.dueDate) &&
    task.dueDate <= endOfToday

const unchanged = (task, before) =>
    task &&
    ['dueDate', 'sortIndex', 'timesPostponed', 'currentReviewerId', 'inDone', 'done'].every(
        field => task[field] === before[field]
    )

export const beginProjectPostpone = ({ projectId, userId, requestId, date, mode, tasks, now = Date.now() }) => {
    const endOfToday = moment(now).endOf('day').valueOf()
    const eligible = tasks.filter(task => isProjectPostponeEligible(task, userId, endOfToday))
    const previews = {}
    // The cloud enforces the authoritative 450-task limit, including unloaded tasks.
    if (eligible.length <= 450) {
        eligible.forEach(task => {
            previews[task.id] = { before: { ...task }, date: mode === 'auto' ? null : date }
        })
    }
    entries.set(projectPostponeKey(projectId, userId), { requestId, endOfToday, previews, saving: true })
    notify()
}

export const finishProjectPostpone = (projectId, userId, requestId) => {
    const entry = getProjectPostpone(projectId, userId)
    if (!entry || entry.requestId !== requestId) return
    entries.set(projectPostponeKey(projectId, userId), { ...entry, saving: false })
    notify()
}

export const clearProjectPostpone = (projectId, userId, requestId) => {
    const key = projectPostponeKey(projectId, userId)
    if (entries.get(key)?.requestId !== requestId) return
    entries.delete(key)
    notify()
}

export const clearProjectPostponeForUndo = actionId => {
    for (const [key, entry] of entries) {
        if (entry.requestId === actionId) entries.delete(key)
    }
    notify()
}

// Retire each overlay once live data changes, even if the callable is still pending. In
// particular, undo's return to the original date must never reactivate an old overlay.
export const reconcileProjectPostpone = (projectId, userId, requestId, tasksById) => {
    const entry = getProjectPostpone(projectId, userId)
    if (!entry || entry.requestId !== requestId) return
    const previews = { ...entry.previews }
    Object.entries(previews).forEach(([id, preview]) => {
        if (!unchanged(tasksById[id], preview.before)) delete previews[id]
    })
    if (Object.keys(previews).length === Object.keys(entry.previews).length) return
    entries.set(projectPostponeKey(projectId, userId), { ...entry, previews })
    notify()
}

export const projectTaskPreview = (task, entry) => {
    const preview = entry?.previews[task.id]
    if (!preview || !unchanged(task, preview.before)) return { task, hidden: false }
    // Auto always leaves today; its exact per-task ladder is intentionally computed by the cloud.
    if (preview.date === null || preview.date > entry.endOfToday) return { task, hidden: true }
    return { task: { ...task, dueDate: preview.date }, hidden: false }
}
