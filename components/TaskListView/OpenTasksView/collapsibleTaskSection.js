/**
 * AT-3027 - the "Messages" and "Calendar" sections of a day on the open-tasks board are collapsed
 * to their first few tasks, each with its own expand / collapse chevron (the same `ShowMoreButton`
 * the main list uses).
 *
 * Product decisions (Karsten, 2026-11-13):
 *   - every displayed day, not only today; every section of every day is toggled independently;
 *   - the state is NOT persisted: like the main list, a reload or a project switch collapses again;
 *   - in the All projects view the chevron jumps into the project (like the main list) and the
 *     section the user pressed arrives expanded there - see `requestSectionExpansion`;
 *   - Calendar keeps its chronological order and shows the first meetings of the day, past ones
 *     included.
 *
 * The limit counts TASKS, not groups: a goal card or "General tasks" group consumes as many slots
 * as it renders tasks, and a group with no slot left is not rendered at all. That is the budget rule
 * the main list applies with `numberTodayTasks`.
 */

export const COLLAPSED_SECTION_TASK_LIMIT = 3

export const MESSAGES_SECTION_KEY = 'messages'
export const CALENDAR_SECTION_KEY = 'calendar'

const taskCountOf = taskList => (Array.isArray(taskList) ? taskList.length : 0)

export const countSectionTasks = taskLists => taskLists.reduce((sum, taskList) => sum + taskCountOf(taskList), 0)

/**
 * The chevron is only offered when it would change something: more tasks than the limit, and not in
 * organize mode, where the drag lists always render every task (as in the main list).
 */
export const shouldOfferSectionToggle = (totalTasks, isActiveOrganizeMode, limit = COLLAPSED_SECTION_TASK_LIMIT) =>
    !isActiveOrganizeMode && totalTasks > limit

/**
 * How many tasks each group may render, in render order. `null` means "all of it" (no cut).
 *
 * `taskLists` is the groups' task lists in the order the user reads them. When `collapsed` is
 * false every entry is `null`; otherwise the first `limit` tasks are shared out front to back and
 * every later group gets `0`.
 */
export const allocateSectionTaskBudget = (taskLists, collapsed, limit = COLLAPSED_SECTION_TASK_LIMIT) => {
    if (!collapsed) return taskLists.map(() => null)

    let remaining = Math.max(0, limit)
    return taskLists.map(taskList => {
        const amount = Math.min(taskCountOf(taskList), remaining)
        remaining -= amount
        return amount
    })
}

/**
 * One-shot hand-off for the All projects -> project jump. The chevron in the All projects view
 * switches to the project; the section that is mounted there consumes the request and starts
 * expanded. Module memory on purpose: nothing is persisted, and a request nobody picks up expires.
 */
const EXPANSION_REQUEST_TTL_MS = 15000
const pendingExpansionRequests = new Map()

export const getSectionExpansionKey = (projectId, dateKey, sectionKey) => `${projectId}|${dateKey}|${sectionKey}`

export const requestSectionExpansion = (expansionKey, now = Date.now()) => {
    pendingExpansionRequests.set(expansionKey, now)
}

export const consumeSectionExpansionRequest = (expansionKey, now = Date.now()) => {
    if (!pendingExpansionRequests.has(expansionKey)) return false
    const requestedAt = pendingExpansionRequests.get(expansionKey)
    pendingExpansionRequests.delete(expansionKey)
    return now - requestedAt <= EXPANSION_REQUEST_TTL_MS
}

export const clearSectionExpansionRequestsForTests = () => pendingExpansionRequests.clear()
