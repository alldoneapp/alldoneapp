import { holdTaskGrouping, holdTaskOrder } from './taskPlacementHold'

const NO_GOAL = '0'

const task = (id, extra) => ({ id, ...extra })
/** `[[goalId, tasks], ...]` - the MAIN_TASK_INDEX shape MainSection reads out of redux. */
const groups = entries => entries.map(([goalId, ids]) => [goalId, ids.map(id => task(id))])
const shapeOf = list => list.map(([goalId, tasks]) => [goalId, tasks.map(t => t.id)])
const idsOf = list => list.map(t => t.id)

describe('taskPlacementHold - holdTaskGrouping', () => {
    it('passes the live grouping straight through while the user is idle', () => {
        const ref = { current: undefined }
        const live = groups([[NO_GOAL, ['a', 'b']]])

        expect(holdTaskGrouping(live, false, ref)).toBe(live)

        const moved = groups([
            [NO_GOAL, ['b']],
            ['goalA', ['a']],
        ])
        expect(holdTaskGrouping(moved, false, ref)).toBe(moved)
    })

    it('AT-2267: keeps a task in its section when a background write assigns it a goal', () => {
        const ref = { current: undefined }

        holdTaskGrouping(
            groups([
                [NO_GOAL, ['editing', 'other']],
                ['goalA', ['x']],
            ]),
            false,
            ref
        )

        // The assistant assigns "editing" to goalA while the user types in it.
        const held = holdTaskGrouping(
            groups([
                [NO_GOAL, ['other']],
                ['goalA', ['x', 'editing']],
            ]),
            true,
            ref
        )

        expect(shapeOf(held)).toEqual([
            [NO_GOAL, ['editing', 'other']],
            ['goalA', ['x']],
        ])
    })

    it('re-creates a section that the live snapshot dropped because its last task moved away', () => {
        const ref = { current: undefined }

        holdTaskGrouping(groups([[NO_GOAL, ['editing']]]), false, ref)

        // "editing" was the only general task, so the general section is gone from the snapshot.
        const held = holdTaskGrouping(groups([['goalA', ['editing']]]), true, ref)

        expect(shapeOf(held)).toEqual([[NO_GOAL, ['editing']]])
    })

    it('drops a section that only exists because of the move it is holding back', () => {
        const ref = { current: undefined }

        holdTaskGrouping(
            groups([
                [NO_GOAL, ['editing', 'other']],
                ['goalA', ['x']],
            ]),
            false,
            ref
        )

        // Moved into a goal that had no tasks of its own: goalB must not render empty.
        const held = holdTaskGrouping(
            groups([
                [NO_GOAL, ['other']],
                ['goalA', ['x']],
                ['goalB', ['editing']],
            ]),
            true,
            ref
        )

        expect(shapeOf(held)).toEqual([
            [NO_GOAL, ['editing', 'other']],
            ['goalA', ['x']],
        ])
    })

    it('still shows tasks created in the background, in their live section', () => {
        const ref = { current: undefined }

        holdTaskGrouping(groups([[NO_GOAL, ['editing']]]), false, ref)

        const held = holdTaskGrouping(
            groups([
                [NO_GOAL, ['editing', 'fresh']],
                ['goalA', ['brandNew']],
            ]),
            true,
            ref
        )

        expect(shapeOf(held)).toEqual([
            [NO_GOAL, ['editing', 'fresh']],
            ['goalA', ['brandNew']],
        ])
    })

    it('lets a task deleted in the background disappear immediately', () => {
        const ref = { current: undefined }

        holdTaskGrouping(groups([[NO_GOAL, ['editing', 'doomed']]]), false, ref)

        expect(shapeOf(holdTaskGrouping(groups([[NO_GOAL, ['editing']]]), true, ref))).toEqual([[NO_GOAL, ['editing']]])
    })

    it('hands back the live task objects, so background field changes are still visible', () => {
        const ref = { current: undefined }

        holdTaskGrouping([[NO_GOAL, [task('editing', { parentGoalId: null })]]], false, ref)

        const liveTask = task('editing', { parentGoalId: 'goalA' })
        const held = holdTaskGrouping([['goalA', [liveTask]]], true, ref)

        expect(held[0][1][0]).toBe(liveTask)
    })

    it('applies everything the hold deferred as soon as editing ends', () => {
        const ref = { current: undefined }
        const before = groups([[NO_GOAL, ['editing']]])
        const after = groups([['goalA', ['editing']]])

        holdTaskGrouping(before, false, ref)
        expect(shapeOf(holdTaskGrouping(after, true, ref))).toEqual([[NO_GOAL, ['editing']]])
        expect(holdTaskGrouping(after, false, ref)).toBe(after)
    })

    it('adopts the live grouping on a first render that happens mid-edit', () => {
        const ref = { current: undefined }
        const live = groups([['goalA', ['a']]])

        expect(holdTaskGrouping(live, true, ref)).toBe(live)
    })

    it('keeps the live identity when the hold changes nothing', () => {
        const ref = { current: undefined }

        holdTaskGrouping(groups([[NO_GOAL, ['a', 'b']]]), false, ref)

        // Same layout, new array from a fresh snapshot (a comment was added to a task).
        const unrelatedUpdate = groups([[NO_GOAL, ['a', 'b']]])
        expect(holdTaskGrouping(unrelatedUpdate, true, ref)).toBe(unrelatedUpdate)
    })

    it('returns a stable reference for repeated renders of the same live input', () => {
        const ref = { current: undefined }

        holdTaskGrouping(groups([[NO_GOAL, ['editing']]]), false, ref)

        // MainSection feeds this into a useEffect dependency list; a new array every render would
        // re-run that effect (and its setState) forever.
        const live = groups([['goalA', ['editing']]])
        const first = holdTaskGrouping(live, true, ref)
        expect(holdTaskGrouping(live, true, ref)).toBe(first)
        expect(holdTaskGrouping(live, true, ref)).toBe(first)
    })

    it('survives missing refs and malformed input', () => {
        expect(holdTaskGrouping(undefined, true, { current: undefined })).toBeUndefined()
        const live = groups([[NO_GOAL, ['a']]])
        expect(holdTaskGrouping(live, true, null)).toBe(live)
    })
})

describe('taskPlacementHold - holdTaskOrder', () => {
    const list = ids => ids.map(id => task(id))

    it('passes the live order through while the user is idle', () => {
        const ref = { current: undefined }
        const live = list(['a', 'b', 'c'])

        expect(holdTaskOrder(live, false, ref)).toBe(live)
    })

    it('AT-2267: holds the rendered order when a background write regenerates sortIndex', () => {
        const ref = { current: undefined }

        holdTaskOrder(list(['a', 'editing', 'b']), false, ref)

        // Assigning a goal regenerates sortIndex, which floats the task to the top of the list.
        expect(idsOf(holdTaskOrder(list(['editing', 'a', 'b']), true, ref))).toEqual(['a', 'editing', 'b'])
    })

    it('holds the order against a background priority change too', () => {
        const ref = { current: undefined }

        holdTaskOrder(list(['a', 'editing', 'b']), false, ref)

        expect(idsOf(holdTaskOrder(list(['b', 'a', 'editing']), true, ref))).toEqual(['a', 'editing', 'b'])
    })

    it('inserts a task created in the background at its live position', () => {
        const ref = { current: undefined }

        holdTaskOrder(list(['a', 'editing', 'b']), false, ref)

        // Relative order of the mounted rows is unchanged, so React inserts the new node without
        // moving any existing one - nothing under the caret is touched.
        expect(idsOf(holdTaskOrder(list(['fresh', 'editing', 'a', 'b']), true, ref))).toEqual([
            'fresh',
            'a',
            'editing',
            'b',
        ])
    })

    it('lets a deleted task disappear immediately', () => {
        const ref = { current: undefined }

        holdTaskOrder(list(['a', 'editing', 'b']), false, ref)

        expect(idsOf(holdTaskOrder(list(['a', 'editing']), true, ref))).toEqual(['a', 'editing'])
    })

    it('re-applies the live order once editing ends', () => {
        const ref = { current: undefined }
        const reordered = list(['editing', 'a', 'b'])

        holdTaskOrder(list(['a', 'editing', 'b']), false, ref)
        holdTaskOrder(reordered, true, ref)

        expect(holdTaskOrder(reordered, false, ref)).toBe(reordered)
    })

    it('adopts the live order on a first render that happens mid-edit', () => {
        const ref = { current: undefined }
        const live = list(['a', 'b'])

        expect(holdTaskOrder(live, true, ref)).toBe(live)
    })

    it('keeps the live identity when the order did not change', () => {
        const ref = { current: undefined }

        holdTaskOrder(list(['a', 'b']), false, ref)

        const sameOrder = list(['a', 'b'])
        expect(holdTaskOrder(sameOrder, true, ref)).toBe(sameOrder)
    })

    it('adopts a list of only unknown tasks rather than emptying it', () => {
        const ref = { current: undefined }

        holdTaskOrder(list(['a', 'b']), false, ref)

        const allNew = list(['x', 'y'])
        expect(holdTaskOrder(allNew, true, ref)).toBe(allNew)
    })

    it('survives missing refs and malformed input', () => {
        expect(holdTaskOrder(undefined, true, { current: undefined })).toBeUndefined()
        const live = list(['a'])
        expect(holdTaskOrder(live, true, null)).toBe(live)
    })
})
