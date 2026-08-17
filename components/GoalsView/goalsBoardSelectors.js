/**
 * Selectors and equality helpers that keep the "All projects - Goals" board from re-rendering
 * its whole project tree every time a single project's board slice is written (AT-2336).
 *
 * The board fans out one `watchAllGoals` + one `watchAllMilestones` listener per active project.
 * Every one of those snapshots writes per-project redux slices, and each write replaces the
 * top-level `boardMilestonesByProject` object. A component subscribed to that whole object
 * therefore re-renders once per project per snapshot -- O(projects^2) work before the view settles.
 *
 * `GoalsViewAllProjects` only needs three things out of that map: which projects have a board,
 * the id of the first milestone of the first visible project, and the first milestone's date for
 * ordering. `selectFirstBoardMilestoneByProject` projects exactly that into a flat string map so
 * it can be compared with `shallowEqual` -- the parent then re-renders only when a project's first
 * milestone actually changes, not on every unrelated per-project write. The milestone arrays
 * themselves are read per project by `MilestonesListByProject`.
 */

const SEPARATOR = '|'

/**
 * Encodes the only two fields the parent board needs from a project's first milestone into a
 * primitive, so the resulting map can be compared with `shallowEqual`. Objects would allocate a
 * new identity on every selector run and defeat the comparison.
 */
export const encodeFirstBoardMilestone = milestone => {
    if (!milestone) return ''
    const date = milestone.date == null ? '' : milestone.date
    const id = milestone.id == null ? '' : milestone.id
    return `${date}${SEPARATOR}${id}`
}

export const decodeFirstBoardMilestone = encoded => {
    if (!encoded) return null
    const separatorIndex = encoded.indexOf(SEPARATOR)
    if (separatorIndex === -1) return null
    const date = Number(encoded.slice(0, separatorIndex))
    return {
        date: Number.isNaN(date) ? null : date,
        id: encoded.slice(separatorIndex + 1),
    }
}

/**
 * `state.boardMilestonesByProject` -> `{ [projectId]: '<firstMilestoneDate>|<firstMilestoneId>' }`,
 * only for projects that currently have at least one board milestone (i.e. projects the
 * All-projects board actually renders a row for).
 */
export const selectFirstBoardMilestoneByProject = state => {
    const boardMilestonesByProject = state.boardMilestonesByProject
    const result = {}
    if (!boardMilestonesByProject) return result
    for (const projectId in boardMilestonesByProject) {
        const milestones = boardMilestonesByProject[projectId]
        if (milestones && milestones.length > 0) {
            result[projectId] = encodeFirstBoardMilestone(milestones[0])
        }
    }
    return result
}

const arraysAreReferenceEqual = (a, b) => {
    if (a === b) return true
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false
    }
    return true
}

/**
 * True when a freshly computed board for a project is element-for-element identical to what is
 * already in redux, so the write (and the render/effect cascade it triggers in every
 * `MilestoneItem`) can be skipped.
 *
 * Comparison is by element *reference* on purpose: goal and milestone objects are rebuilt by
 * `mapGoalData`/`mapMilestoneData` on every Firestore snapshot, so a real snapshot always compares
 * unequal and is never swallowed. Only recomputations triggered by something other than new data
 * (mount, tab switch, "show more" toggle, unrelated redux churn) can match and be skipped.
 */
export const isSameBoardResult = (previous, next) => {
    if (!previous) return false
    // The reducers for these three delete the project key instead of storing a falsy value, so
    // "absent" and "0"/"false" are the same state and must compare equal -- otherwise the guard
    // never fires for the (many) projects that contribute no goals to the board.
    if (!!previous.boardNeedShowMore !== !!next.boardNeedShowMore) return false
    if ((previous.openGoalsAmount || 0) !== (next.openGoalsAmount || 0)) return false
    if ((previous.doneGoalsAmount || 0) !== (next.doneGoalsAmount || 0)) return false
    if (!arraysAreReferenceEqual(previous.boardMilestones, next.boardMilestones)) return false

    const previousGoals = previous.boardGoalsByMilestones
    const nextGoals = next.boardGoalsByMilestones
    if (previousGoals === nextGoals) return true
    if (!previousGoals || !nextGoals) return false

    const previousKeys = Object.keys(previousGoals)
    const nextKeys = Object.keys(nextGoals)
    if (previousKeys.length !== nextKeys.length) return false
    for (let i = 0; i < nextKeys.length; i++) {
        const key = nextKeys[i]
        if (!Object.prototype.hasOwnProperty.call(previousGoals, key)) return false
        if (!arraysAreReferenceEqual(previousGoals[key], nextGoals[key])) return false
    }
    return true
}
