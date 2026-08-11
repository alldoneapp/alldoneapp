/**
 * AT-2267 - the regression this hold exists for, reproduced against a real React reconciler.
 *
 * `taskPlacementHold.test.js` pins the shape of the data. This suite pins the *consequence*: it
 * mirrors the structure MainSection renders (one keyed block per goal, keyed task rows inside it,
 * and a row child whose open-editor flag and draft text live in component-local state) and moves a
 * task between goals exactly the way a background `parentGoalId` write does.
 *
 * Without the hold React cannot move a subtree between parents, so it unmounts the row and mounts a
 * new one: the draft is gone and the editor is closed, with no error anywhere. That is the bug the
 * user reported as "it loses its focus". With the hold applied the very same update leaves the
 * subtree untouched.
 */
import React, { useRef, useState } from 'react'
import renderer, { act } from 'react-test-renderer'

import { holdTaskGrouping } from './taskPlacementHold'

const NO_GOAL = '0'

const groups = entries => entries.map(([goalId, ids]) => [goalId, ids.map(id => ({ id }))])

let mountedEditors

/** Stands in for DismissibleItem + EditTask: open state and draft text are component-local. */
function TaskRow({ task }) {
    const [draft, setDraft] = useState(null)
    mountedEditors.set(task.id, { draft, setDraft })
    return null
}

/** Stands in for MainSection: keyed goal blocks, keyed task rows, optional placement hold. */
function TaskList({ mainTasks, isUserEditing, withHold }) {
    const groupingRef = useRef(undefined)
    const sections = withHold ? holdTaskGrouping(mainTasks, isUserEditing, groupingRef) : mainTasks

    return (
        <>
            {sections.map(([goalId, tasks]) => (
                <React.Fragment key={goalId}>
                    {tasks.map(task => (
                        <TaskRow key={task.id} task={task} />
                    ))}
                </React.Fragment>
            ))}
        </>
    )
}

const BEFORE = groups([
    [NO_GOAL, ['editing', 'other']],
    ['goalA', ['x']],
])

// Exactly what an assistant auto-assigning a goal produces: the task leaves the general block and
// joins goalA, and its regenerated sortIndex puts it first there.
const AFTER_GOAL_ASSIGNED = groups([
    [NO_GOAL, ['other']],
    ['goalA', ['editing', 'x']],
])

const renderList = props => {
    let tree
    act(() => {
        tree = renderer.create(<TaskList {...props} />)
    })
    return tree
}

const typeIntoEditor = text => {
    act(() => {
        mountedEditors.get('editing').setDraft(text)
    })
}

const draftOf = taskId => mountedEditors.get(taskId).draft

describe('AT-2267 - an open task editor survives a background goal assignment', () => {
    beforeEach(() => {
        mountedEditors = new Map()
    })

    it('reproduces the bug: without the hold the row remounts and the draft is lost', () => {
        const tree = renderList({ mainTasks: BEFORE, isUserEditing: false, withHold: false })

        typeIntoEditor('a half-typed task name')
        expect(draftOf('editing')).toBe('a half-typed task name')

        act(() => {
            tree.update(<TaskList mainTasks={AFTER_GOAL_ASSIGNED} isUserEditing={true} withHold={false} />)
        })

        // The row was re-created under the goalA block: local state is back at its initial value.
        expect(draftOf('editing')).toBeNull()
    })

    it('with the hold the editor keeps its draft across the same update', () => {
        const tree = renderList({ mainTasks: BEFORE, isUserEditing: false, withHold: true })

        typeIntoEditor('a half-typed task name')

        act(() => {
            tree.update(<TaskList mainTasks={AFTER_GOAL_ASSIGNED} isUserEditing={true} withHold={true} />)
        })

        expect(draftOf('editing')).toBe('a half-typed task name')
    })

    it('keeps the draft across a whole burst of background updates', () => {
        const tree = renderList({ mainTasks: BEFORE, isUserEditing: false, withHold: true })

        typeIntoEditor('still typing')

        const updates = [
            AFTER_GOAL_ASSIGNED,
            // ... a task created by the assistant lands in the same list ...
            groups([
                [NO_GOAL, ['other', 'fresh']],
                ['goalA', ['editing', 'x']],
            ]),
            // ... and an unrelated task is completed elsewhere.
            groups([
                [NO_GOAL, ['other', 'fresh']],
                ['goalA', ['editing']],
            ]),
        ]

        updates.forEach(mainTasks => {
            act(() => {
                tree.update(<TaskList mainTasks={mainTasks} isUserEditing={true} withHold={true} />)
            })
            expect(draftOf('editing')).toBe('still typing')
        })

        // The new task really did render - the hold defers restructuring, it never hides data.
        expect(mountedEditors.has('fresh')).toBe(true)
    })

    it('lets the task move to its new goal once the editor is closed', () => {
        const tree = renderList({ mainTasks: BEFORE, isUserEditing: false, withHold: true })

        typeIntoEditor('done typing')

        act(() => {
            tree.update(<TaskList mainTasks={AFTER_GOAL_ASSIGNED} isUserEditing={true} withHold={true} />)
        })
        expect(draftOf('editing')).toBe('done typing')

        // Editor dismissed: the deferred move is applied, and the row is free to remount.
        act(() => {
            tree.update(<TaskList mainTasks={AFTER_GOAL_ASSIGNED} isUserEditing={false} withHold={true} />)
        })
        expect(draftOf('editing')).toBeNull()
    })
})
