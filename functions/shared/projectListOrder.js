'use strict'

/**
 * AT-3085 — the order of the user's project list, shared by everything that has to agree with it:
 * the sidebar (`ProjectHelper.sortProjects`), the app's focus-task pick
 * (`findAndSetNewFocusedTask` in utils/backends/Tasks/tasksFirestore.js) and the server's
 * (`FocusTaskService.findAndSetNewFocusTask`). The focus pick walks the projects in this order, so
 * the first project the user sees in the list is the first one searched for a focus task.
 *
 * The order is the user's own `project.sortIndexByUser[userId]`, highest first, then the name
 * (A → Z, case-insensitive). It reproduces the lodash `orderBy(..., ['desc', 'asc'])` the sidebar
 * has always used, edge cases included: a project with no sort index yet sits at the TOP (lodash
 * ranks a missing value above every number in a descending sort), so the pick searches it first
 * too, exactly where the user sees it.
 *
 * Plain CommonJS with no imports: the app imports it from here, Cloud Functions require it.
 */

// Rank of a sort value in a descending lodash sort: NaN first, then undefined, then null, then numbers.
const MISSING_RANKS = { nan: 0, undefined: 1, null: 2 }
const NUMBER_RANK = 3

const readSortValue = (project, userId) => {
    const value = project && project.sortIndexByUser ? project.sortIndexByUser[userId] : undefined
    if (value === null) return { rank: MISSING_RANKS.null, value: 0 }
    if (value === undefined) return { rank: MISSING_RANKS.undefined, value: 0 }
    const number = typeof value === 'number' ? value : Number(value)
    if (Number.isNaN(number)) return { rank: MISSING_RANKS.nan, value: 0 }
    return { rank: NUMBER_RANK, value: number }
}

const readName = project => (project && typeof project.name === 'string' ? project.name.toLowerCase() : '')

/** Comparator for `Array.prototype.sort`: negative when `a` comes before `b` in the project list. */
function compareProjectsInListOrder(a, b, userId) {
    const sortA = readSortValue(a, userId)
    const sortB = readSortValue(b, userId)
    if (sortA.rank !== sortB.rank) return sortA.rank - sortB.rank
    if (sortA.value !== sortB.value) return sortB.value > sortA.value ? 1 : -1
    const nameA = readName(a)
    const nameB = readName(b)
    if (nameA === nameB) return 0
    return nameA < nameB ? -1 : 1
}

/** A sorted copy of `projects` in project-list order (stable; never mutates the input). */
function sortProjectsInListOrder(projects, userId) {
    return (Array.isArray(projects) ? projects : [])
        .filter(Boolean)
        .map((project, index) => ({ project, index }))
        .sort((a, b) => compareProjectsInListOrder(a.project, b.project, userId) || a.index - b.index)
        .map(entry => entry.project)
}

/**
 * The project ids a focus search walks through, in order:
 *  1. `startProjectId` when given and searchable (after completing or postponing a focus task the
 *     search stays in that task's project first);
 *  2. the listed projects (`listedProjects`: the active projects the sidebar shows) in list order;
 *  3. the other searchable projects (`otherProjects`, e.g. guide projects the user is a member of),
 *     also in list order, as the last fallback.
 * Every id appears once.
 */
function orderProjectIdsForFocusSearch({ listedProjects = [], otherProjects = [], userId, startProjectId = null }) {
    const ids = []
    const seen = new Set()
    const add = id => {
        if (!id || seen.has(id)) return
        seen.add(id)
        ids.push(id)
    }
    const listed = sortProjectsInListOrder(listedProjects, userId).map(project => project.id)
    const others = sortProjectsInListOrder(otherProjects, userId).map(project => project.id)
    if (startProjectId && (listed.includes(startProjectId) || others.includes(startProjectId))) add(startProjectId)
    listed.forEach(add)
    others.forEach(add)
    return ids
}

module.exports = {
    compareProjectsInListOrder,
    sortProjectsInListOrder,
    orderProjectIdsForFocusSearch,
}
