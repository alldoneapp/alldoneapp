/**
 * AT-2249 - keeps the focus task's section pinned to the top *while* the user edits it.
 *
 * MainSection lifts the section holding the focus task to the top of the open task list, which is
 * why a focus task legitimately shows higher than its goal's normal position.
 *
 * That reorder is dangerous during editing: the section list is keyed, so React moves the existing
 * DOM nodes, and moving a node blurs whatever is focused inside it. AT-2203 therefore stopped
 * pinning while `isUserEditing` - but dropping an *already applied* pin is itself a reorder, and it
 * is the reorder the user notices most, because the section they are typing in is the one that
 * moves. Clicking into a focus task's input dropped its section back to its natural position, and
 * closing the editor lifted it up again: the task "jumps around" for the whole edit session.
 *
 * The distinction that matters is between *holding* the current order and *recomputing* it. While
 * the user is busy we keep applying the last pin decision taken while idle, so:
 *
 *  - a pin that was already applied stays applied (no jump when an editor opens or closes), and
 *  - a background change to `inFocusTaskId` still cannot reorder anything under the caret; it is
 *    deferred to the next idle render, exactly as AT-2203 intended.
 *
 * `pinnedRef` is a React ref carrying that decision across renders. `undefined` means "never
 * resolved" (first render, or a remount that happened while editing) and adopts the current value;
 * `null` means "resolved to no pin".
 */

/**
 * The section id to pin this render: the live one while idle, the last idle one while editing.
 */
export const resolvePinnedSectionId = (focusedSectionId, isUserEditing, pinnedRef) => {
    const liveSectionId = focusedSectionId || null

    if (!pinnedRef) return liveSectionId

    // Never resolved yet: there is no previous order to preserve, so adopt the live value even
    // when editing (a section mounted mid-edit would otherwise render unpinned and then jump).
    if (!isUserEditing || pinnedRef.current === undefined) {
        pinnedRef.current = liveSectionId
        return liveSectionId
    }

    return pinnedRef.current
}

/**
 * Moves the pinned section to the front of `sections` in place (the array is rebuilt every render,
 * so mutating it is safe). A pin naming a section that is not in the list is a no-op.
 */
export const pinSectionToTop = (sections, pinnedSectionId) => {
    if (!pinnedSectionId || !Array.isArray(sections)) return sections

    const pinnedIndex = sections.findIndex(section => Array.isArray(section) && section[0] === pinnedSectionId)
    if (pinnedIndex > 0) {
        const [pinnedSection] = sections.splice(pinnedIndex, 1)
        sections.unshift(pinnedSection)
    }

    return sections
}
