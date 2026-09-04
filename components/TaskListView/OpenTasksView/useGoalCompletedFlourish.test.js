import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useGoalCompletedFlourish, { RESET_AFTER_RUN_MS } from './useGoalCompletedFlourish'
import { publishGoalTaskCompletion, resetGoalTaskCompletionListeners } from './goalCompletionSignal'

/**
 * AT-2507 — the rule that decides a goal has just had its last task of the day completed.
 *
 * The cases worth reading are the ones that must NOT fire. A goal's day bucket empties for several
 * reasons and only one of them is an achievement, so most of this suite is about the section
 * staying silent: a task belonging to another goal or another project, a task of a sibling section
 * of the same goal, a section that is not allowed to celebrate, and — the one that would be most
 * visible in production — a goal that still has other tasks left.
 */

const PROJECT = 'project-a'
const GOAL = 'goal-1'

const task = id => ({ id })

let latest

const Host = ({ projectId = PROJECT, goalId = GOAL, taskList = [], enabled = true }) => {
    latest = useGoalCompletedFlourish({ projectId, goalId, taskList, enabled })
    return null
}

const mount = props => {
    let tree
    act(() => {
        tree = renderer.create(<Host {...props} />)
    })
    return tree
}

const complete = event =>
    act(() => {
        publishGoalTaskCompletion(event)
    })

describe('useGoalCompletedFlourish (AT-2507)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        latest = undefined
        resetGoalTaskCompletionListeners()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('does not celebrate a goal nobody has finished anything in', () => {
        mount({ taskList: [task('t1')] })
        expect(latest).toBe(0)
    })

    it('celebrates when the only task of the goal is completed', () => {
        mount({ taskList: [task('t1')] })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })

        expect(latest).toBe(1)
    })

    it('waits for the LAST task, not the first', () => {
        mount({ taskList: [task('t1'), task('t2'), task('t3')] })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })
        expect(latest).toBe(0)

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't2' })
        expect(latest).toBe(0)

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't3' })
        expect(latest).toBe(1)
    })

    it('remembers tasks completed earlier in the day, as the list shrinks under it', () => {
        const tree = mount({ taskList: [task('t1'), task('t2')] })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })
        expect(latest).toBe(0)

        // The snapshot lands and drops the completed task from the section, exactly as
        // `generateOpenTasksArray` does.
        act(() => {
            tree.update(<Host taskList={[task('t2')]} />)
        })
        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't2' })

        expect(latest).toBe(1)
    })

    it('ignores a completion in another goal or another project', () => {
        mount({ taskList: [task('t1')] })

        complete({ projectId: PROJECT, goalId: 'goal-2', taskId: 't1' })
        complete({ projectId: 'project-b', goalId: GOAL, taskId: 't1' })

        expect(latest).toBe(0)
    })

    /**
     * The same goal can render in the main list and in the observed / mention / suggested lists at
     * the same time, each with its own tasks. Matching against the section's OWN list is what keeps
     * one section's clearing from celebrating on the others.
     */
    it('ignores a task of the same goal that belongs to a sibling section', () => {
        mount({ taskList: [task('mine-1')] })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 'theirs-1' })

        expect(latest).toBe(0)
    })

    it('never subscribes when the section may not celebrate', () => {
        mount({ taskList: [task('t1')], enabled: false })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })

        expect(latest).toBe(0)
    })

    it('does not fire for an empty section', () => {
        mount({ taskList: [] })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })

        expect(latest).toBe(0)
    })

    it('fires once per clearing, however many times the same task is announced', () => {
        mount({ taskList: [task('t1')] })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })
        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })

        expect(latest).toBe(1)
    })

    /**
     * AT-2506's rule one scope up: a clearing is an event, not a day. A goal you clear, refill and
     * clear again is celebrated twice.
     */
    it('celebrates a goal that is refilled and cleared again', () => {
        const tree = mount({ taskList: [task('t1')] })

        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })
        expect(latest).toBe(1)

        act(() => {
            jest.advanceTimersByTime(RESET_AFTER_RUN_MS)
        })
        act(() => {
            tree.update(<Host taskList={[task('t2')]} />)
        })
        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't2' })

        expect(latest).toBe(2)
    })

    it('stops listening once the section is unmounted', () => {
        const tree = mount({ taskList: [task('t1')] })
        act(() => {
            tree.unmount()
        })

        // No throw, and nothing to assert on beyond that: an unsubscribed section that still
        // called `setState` here would fail the test through React's own warning.
        complete({ projectId: PROJECT, goalId: GOAL, taskId: 't1' })
    })
})
