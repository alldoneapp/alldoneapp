/**
 * AT-2267 - keeps a task where it is while its editor is open.
 *
 * The open task list is not one flat list: `MainSection` renders one keyed block per goal
 * (`<ParentGoalSection key={goalId}>`, plus a `<View key={NOT_PARENT_GOAL_INDEX}>` for the general
 * tasks), and each block renders `<ParentTaskContainer key={task.id}>`. Which block a task lands in
 * is derived from `task.parentGoalId` by the snapshot pipeline (`generateOpenTasksArray`), so a
 * *background* write to that one field re-buckets the task.
 *
 * React cannot move a subtree between parents. A re-bucketed task is therefore unmounted from its
 * old block and mounted fresh in the new one, and everything that lived in component-local state
 * goes with it: `DismissibleItem.state.visibleModal` (the "editor is open" flag) and `EditTask`'s
 * `tmpTask` (the half-typed title). The editor simply vanishes mid-keystroke. This is exactly what
 * an assistant auto-assigning a goal does, and the same is true of anything else that changes the
 * grouping key.
 *
 * Reordering is the milder version of the same problem: every one of those goal writes also
 * regenerates `sortIndex`, and a background priority change re-sorts too. The subtree survives, but
 * React reorders a keyed list by *moving* DOM nodes, and moving a node blurs whatever is focused
 * inside it - the caret is gone even though the editor is still open (see utils/editingGuard.js).
 *
 * So while the user is editing, hold both placements at their last idle value:
 *
 *  - `holdTaskGrouping` keeps every already-seen task in the section it was rendered in, and
 *  - `holdTaskOrder` keeps the already-seen tasks of one section in the order they were rendered.
 *
 * As with `focusSectionPin`, this is a *hold*, not a filter: incoming data is never hidden. New
 * tasks appear immediately (at their live position), deleted tasks disappear immediately, and every
 * field of every task - including the new `parentGoalId` - is the live one. Only the *restructuring*
 * of what is already mounted waits for the next idle render, at which point the task slides into its
 * new goal section with nothing at stake.
 *
 * Both helpers take a React ref carrying the decision across renders, and both follow the
 * `holdWhileEditing` convention: `undefined` means "never resolved" (first render, or a remount that
 * happened mid-edit) and adopts the live value even while editing, because there is no previous
 * layout worth preserving.
 *
 * Reference stability matters here. `MainSection` feeds the grouped list to a `useEffect` dependency
 * list, so a helper that returned a freshly built array on every render would re-run that effect (and
 * its `setState`) in a loop. Both helpers therefore return the live input untouched whenever the hold
 * is a no-op, and otherwise memoise their result against the live input's identity.
 */

const idOf = task => (task ? task.id : undefined)

/**
 * Orders one list so the tasks that were already rendered keep their remembered relative order,
 * while tasks nobody has seen yet are inserted at their live position.
 *
 * Keeping the *relative* order of the mounted rows is the point: React then only inserts the new
 * node and never moves an existing one, so nothing under the caret is touched.
 *
 * @param entries `[{ task, heldIndex, liveIndex }]`, `heldIndex === undefined` for a new task
 */
const orderWithHeldRanks = entries => {
    const known = entries.filter(entry => entry.heldIndex !== undefined)
    const fresh = entries.filter(entry => entry.heldIndex === undefined)

    known.sort((a, b) => a.heldIndex - b.heldIndex)

    const ordered = known.map(entry => entry.task)
    fresh.forEach(entry => {
        ordered.splice(Math.min(entry.liveIndex, ordered.length), 0, entry.task)
    })

    return ordered
}

/** Where each task was rendered - which section, and at which index inside it. */
const buildPlacementIndex = groups => {
    const placementByTaskId = new Map()

    groups.forEach(group => {
        if (!Array.isArray(group)) return
        const [sectionId, tasks] = group
        if (!Array.isArray(tasks)) return
        tasks.forEach((task, index) => {
            const taskId = idOf(task)
            if (taskId !== undefined) placementByTaskId.set(taskId, { sectionId, index })
        })
    })

    return placementByTaskId
}

const sameGrouping = (a, b) => {
    if (a.length !== b.length) return false
    return a.every((group, index) => {
        const other = b[index]
        if (group === other) return true
        if (!Array.isArray(group) || !Array.isArray(other)) return false
        if (group[0] !== other[0]) return false
        const tasks = group[1]
        const otherTasks = other[1]
        if (!Array.isArray(tasks) || !Array.isArray(otherTasks)) return false
        if (tasks.length !== otherTasks.length) return false
        return tasks.every((task, taskIndex) => task === otherTasks[taskIndex])
    })
}

/**
 * Re-buckets the live groups so every task the user has already seen stays in the section it was
 * rendered in. Sections that end up empty are dropped; a section that only exists in the held layout
 * (the task was the last one in it, so the live snapshot no longer lists it at all) is re-created in
 * the position it used to hold.
 */
const applyHeldGrouping = (groups, placementByTaskId) => {
    // Live section order first, so a section that is still live keeps its live position; a section
    // that only survives in the hold is appended after them.
    const entriesBySectionId = new Map()
    const sectionOrder = []

    const ensureSection = sectionId => {
        if (!entriesBySectionId.has(sectionId)) {
            entriesBySectionId.set(sectionId, [])
            sectionOrder.push(sectionId)
        }
        return entriesBySectionId.get(sectionId)
    }

    groups.forEach(group => {
        if (Array.isArray(group)) ensureSection(group[0])
    })

    groups.forEach(group => {
        if (!Array.isArray(group)) return
        const [liveSectionId, tasks] = group
        if (!Array.isArray(tasks)) return

        tasks.forEach((task, liveIndex) => {
            const taskId = idOf(task)
            const placement = taskId !== undefined ? placementByTaskId.get(taskId) : undefined
            // A task the user has not seen yet has no held placement: it is brand new, so it
            // renders wherever the live data puts it.
            const sectionId = placement === undefined ? liveSectionId : placement.sectionId
            ensureSection(sectionId).push({ task, heldIndex: placement && placement.index, liveIndex })
        })
    })

    const held = []
    sectionOrder.forEach(sectionId => {
        const entries = entriesBySectionId.get(sectionId)
        if (entries.length > 0) held.push([sectionId, orderWithHeldRanks(entries)])
    })

    return held
}

/**
 * @param groups        live `[[goalId, tasks], ...]` list (the MAIN_TASK_INDEX bucket)
 * @param isUserEditing reactive editing signal, see utils/editingGuard.js
 * @param groupingRef   React ref carrying the held layout across renders
 */
export const holdTaskGrouping = (groups, isUserEditing, groupingRef) => {
    if (!Array.isArray(groups) || !groupingRef) return groups

    const held = groupingRef.current

    if (!isUserEditing || held === undefined) {
        groupingRef.current = { placementByTaskId: buildPlacementIndex(groups), live: groups, result: groups }
        return groups
    }

    // Same live input as the previous render: hand back the very same array so consumers using it as
    // an effect dependency do not see a change that is not one.
    if (held.live === groups) return held.result

    const regrouped = applyHeldGrouping(groups, held.placementByTaskId)
    // The hold changed nothing - keep the live identity rather than a copy of it.
    const result = sameGrouping(regrouped, groups) ? groups : regrouped

    groupingRef.current = { placementByTaskId: held.placementByTaskId, live: groups, result }
    return result
}

/**
 * Keeps the already-seen tasks of one list in the order they were rendered.
 *
 * New tasks are inserted at their live position rather than appended: as long as the *relative*
 * order of the mounted rows is unchanged, React only inserts the new node and never moves an
 * existing one, so nothing under the caret is touched.
 *
 * Apply this to the final, sorted list - the order that actually reaches the DOM.
 */
export const holdTaskOrder = (tasks, isUserEditing, orderRef) => {
    if (!Array.isArray(tasks) || !orderRef) return tasks

    if (!isUserEditing || orderRef.current === undefined) {
        orderRef.current = tasks.map(idOf)
        return tasks
    }

    const heldRank = new Map()
    orderRef.current.forEach((taskId, index) => {
        if (taskId !== undefined) heldRank.set(taskId, index)
    })

    const entries = tasks.map((task, liveIndex) => ({ task, heldIndex: heldRank.get(idOf(task)), liveIndex }))

    // Nothing on screen is remembered, so there is no layout to preserve.
    if (entries.every(entry => entry.heldIndex === undefined)) return tasks

    const ordered = orderWithHeldRanks(entries)

    const unchanged = ordered.length === tasks.length && ordered.every((task, index) => task === tasks[index])
    return unchanged ? tasks : ordered
}

export default holdTaskGrouping
