/**
 * Keeps already-mounted task sections mounted while the user is typing.
 *
 * MainSection renders its goal sections against a single running budget
 * (`globalAmountToRender`, seeded from the user's "number of today tasks"
 * setting). Each section consumes part of it in render order and, once the
 * budget is exhausted, later sections render `null`.
 *
 * That is fine when the list changes because the user did something. It is not
 * fine when a background snapshot changes it: a task an assistant adds to an
 * *earlier* section consumes more budget, which can push a later section below
 * the threshold. React then unmounts that section - and with it any open
 * `DismissibleItem` editor, whose open flag and typed text live in local
 * component state and are simply lost.
 *
 * So while the user is busy we hold every section at the size it had in the
 * last idle render. New tasks still render immediately; only shrinking is
 * deferred. Once the user is done, the next idle render takes a fresh snapshot
 * and the list settles back to its natural size.
 *
 * `amountsRef` is a React ref (`{ current: {} }`) carrying that snapshot across
 * renders: a key is present when the section rendered, its value is the number
 * of tasks it rendered.
 */
export const createSectionRenderBudget = (isUserEditing, amountsRef) => {
    const previous = amountsRef.current || {}

    // While idle, rebuild the snapshot from scratch so sections that
    // legitimately went away are dropped instead of being pinned forever.
    // While editing, keep it byte-for-byte so the floor cannot drift.
    if (!isUserEditing) amountsRef.current = {}

    /** The section rendered in the last idle render, so it is mounted now. */
    const wasMounted = sectionId => isUserEditing && previous[sectionId] !== undefined

    return {
        wasMounted,

        /**
         * Floor `amount` at whatever this section rendered while idle, so a
         * section can grow with incoming data but never shrink mid-edit.
         */
        resolve: (sectionId, amount) => (wasMounted(sectionId) ? Math.max(amount, previous[sectionId]) : amount),

        /**
         * True when the section must not render at all. `amount <= 0` alone is
         * not enough, and there are two carve-outs:
         *
         *  - a mounted section stays mounted until the user is done (AT-2203);
         *  - a section that is LEAVING stays mounted until it has left
         *    (AT-2507). A goal section playing its departure carries no tasks,
         *    because its rows have already collapsed, so it resolves to
         *    `amount === 0` and would be skipped on every truncated list — i.e.
         *    on the ordinary board, where the day is cut to the user's "number
         *    of today tasks" setting. It would render `null` while the hold
         *    still kept its space out of the layout: the same pop, one
         *    animation later. Skipping it is wrong on its own terms too — this
         *    budget exists to stop a list rendering more rows than were asked
         *    for, and a leaving section is rendering none.
         */
        shouldSkip: (sectionId, amount, baseCondition, { leaving = false } = {}) =>
            !!baseCondition && amount <= 0 && !wasMounted(sectionId) && !leaving,

        /** Record what a section actually rendered (idle renders only). */
        remember: (sectionId, amount) => {
            if (!isUserEditing) amountsRef.current[sectionId] = amount
        },
    }
}

export default createSectionRenderBudget
