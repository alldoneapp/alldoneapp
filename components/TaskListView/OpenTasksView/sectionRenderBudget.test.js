import { createSectionRenderBudget } from './sectionRenderBudget'

const makeRef = (current = {}) => ({ current })

/**
 * Reproduces one MainSection render pass: sections are walked in order, each
 * consuming from the shared budget, and a section that resolves to 0 is
 * skipped. Returns which sections rendered and with how many tasks.
 */
const renderPass = (sections, { budgetStart, isUserEditing, amountsRef }) => {
    const budget = createSectionRenderBudget(isUserEditing, amountsRef)
    let remaining = budgetStart
    const rendered = {}

    sections.forEach(({ id, taskCount }) => {
        const amount = budget.resolve(id, Math.min(remaining, taskCount))
        if (budget.shouldSkip(id, amount, true)) return
        budget.remember(id, amount)
        rendered[id] = amount
        remaining = remaining > taskCount ? remaining - taskCount : 0
    })

    return rendered
}

describe('sectionRenderBudget - idle behaviour is unchanged', () => {
    it('still starves later sections out of the budget when nobody is typing', () => {
        const amountsRef = makeRef()
        const rendered = renderPass(
            [
                { id: 'goalA', taskCount: 4 },
                { id: 'goalB', taskCount: 2 },
            ],
            { budgetStart: 4, isUserEditing: false, amountsRef }
        )

        expect(rendered).toEqual({ goalA: 4 })
        expect(rendered.goalB).toBeUndefined()
    })

    it('records what each section rendered so the next render can floor it', () => {
        const amountsRef = makeRef()
        renderPass(
            [
                { id: 'goalA', taskCount: 2 },
                { id: 'goalB', taskCount: 1 },
            ],
            { budgetStart: 10, isUserEditing: false, amountsRef }
        )

        expect(amountsRef.current).toEqual({ goalA: 2, goalB: 1 })
    })

    it('drops sections that legitimately went away instead of pinning them', () => {
        const amountsRef = makeRef({ goalGone: 3 })
        renderPass([{ id: 'goalA', taskCount: 1 }], { budgetStart: 10, isUserEditing: false, amountsRef })

        expect(amountsRef.current).toEqual({ goalA: 1 })
    })
})

describe('sectionRenderBudget - AT-2203: a background task must not unmount an open editor', () => {
    it('keeps a mounted section rendered when an earlier section eats the budget', () => {
        // Idle: budget 4 covers both sections exactly.
        const amountsRef = makeRef()
        const before = renderPass(
            [
                { id: 'goalA', taskCount: 3 },
                { id: 'goalB', taskCount: 1 },
            ],
            { budgetStart: 4, isUserEditing: false, amountsRef }
        )
        expect(before).toEqual({ goalA: 3, goalB: 1 })

        // The user opens the add-task editor inside goalB and starts typing.
        // Meanwhile an assistant adds a task to goalA, consuming the whole
        // budget. Without the floor, goalB would resolve to 0 and unmount.
        const after = renderPass(
            [
                { id: 'goalA', taskCount: 4 },
                { id: 'goalB', taskCount: 1 },
            ],
            { budgetStart: 4, isUserEditing: true, amountsRef }
        )

        expect(after.goalB).toBe(1)
    })

    it('lets a section grow with incoming data while editing, but never shrink', () => {
        const amountsRef = makeRef({ goalA: 2 })
        const budget = createSectionRenderBudget(true, amountsRef)

        expect(budget.resolve('goalA', 5)).toBe(5) // grew - show the new tasks
        expect(budget.resolve('goalA', 0)).toBe(2) // shrank - hold the floor
    })

    it('does not resurrect a section that was not mounted before', () => {
        const amountsRef = makeRef({ goalA: 2 })
        const budget = createSectionRenderBudget(true, amountsRef)

        expect(budget.wasMounted('goalNew')).toBe(false)
        expect(budget.shouldSkip('goalNew', 0, true)).toBe(true)
    })

    it('freezes the snapshot while editing so the floor cannot drift', () => {
        const amountsRef = makeRef({ goalA: 3 })
        const budget = createSectionRenderBudget(true, amountsRef)

        budget.remember('goalA', 0)
        budget.remember('goalB', 9)

        expect(amountsRef.current).toEqual({ goalA: 3 })
    })

    it('settles back to the natural size on the next idle render', () => {
        const amountsRef = makeRef()
        renderPass(
            [
                { id: 'goalA', taskCount: 3 },
                { id: 'goalB', taskCount: 1 },
            ],
            { budgetStart: 4, isUserEditing: false, amountsRef }
        )
        renderPass(
            [
                { id: 'goalA', taskCount: 4 },
                { id: 'goalB', taskCount: 1 },
            ],
            { budgetStart: 4, isUserEditing: true, amountsRef }
        )

        // User closes the editor: the deferred shrink is applied.
        const settled = renderPass(
            [
                { id: 'goalA', taskCount: 4 },
                { id: 'goalB', taskCount: 1 },
            ],
            { budgetStart: 4, isUserEditing: false, amountsRef }
        )

        expect(settled).toEqual({ goalA: 4 })
    })
})

describe('sectionRenderBudget - AT-2507: a section that is leaving must still render', () => {
    /**
     * A goal section playing its departure has no tasks left under it — they have already collapsed
     * away — so it always resolves to `amount === 0`. On a truncated list (the ordinary board, cut
     * to the user's "number of today tasks") that is exactly the shape the budget skips, and a
     * skipped section renders `null` while `MainSection` still holds its place out of the layout:
     * the same pop the animation exists to remove, one animation later.
     */
    it('does not skip a leaving section that has nothing left to render', () => {
        const budget = createSectionRenderBudget(false, { current: {} })

        expect(budget.shouldSkip('goal-1', 0, true)).toBe(true)
        expect(budget.shouldSkip('goal-1', 0, true, { leaving: true })).toBe(false)
    })

    it('leaves every other section exactly as it was', () => {
        const budget = createSectionRenderBudget(false, { current: {} })

        // The flag is opt-in, so an untouched call site cannot change behaviour.
        expect(budget.shouldSkip('goal-1', 0, true, {})).toBe(true)
        expect(budget.shouldSkip('goal-1', 0, true, { leaving: false })).toBe(true)
        expect(budget.shouldSkip('goal-1', 2, true, { leaving: false })).toBe(false)
        expect(budget.shouldSkip('goal-1', 0, false, { leaving: false })).toBe(false)
    })
})
