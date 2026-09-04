import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'

import useGoalSectionExit, { COMPLETION_MEMORY_MS, GOAL_SECTION_HOLD_MS } from './useGoalSectionExit'
import { publishGoalTaskCompletion, resetGoalTaskCompletionListeners } from './goalCompletionSignal'

/**
 * AT-2507 — the rule that decides a goal section is LEAVING today's list because its work is done,
 * and the hold that keeps it on the board long enough to leave gracefully.
 *
 * Most of this suite is about the section staying silent, because a goal block disappears for
 * several reasons and only one of them is finished work. Two of those cases are the ones the whole
 * design turns on:
 *
 *   • a cleared goal that is still ACTIVE for today does not leave at all — it reappears as an
 *     `EmptyGoal` under the same key, so it arrives here in `emptyGoals` and must animate nothing;
 *   • a goal whose last task was moved or deleted rather than completed leaves exactly as it always
 *     did, instantly.
 *
 * Motion is inert under jest by convention and the hold is deliberately not taken when there would
 * be nothing to see, so this suite opts out of that convention — otherwise every assertion would
 * pass vacuously against a hook that had correctly decided to do nothing.
 */

const PROJECT = 'project-a'
const GOAL = 'goal-1'
const OTHER_GOAL = 'goal-2'

const task = id => ({ id })
const section = (goalId, tasks) => [goalId, tasks]
const emptyGoal = id => ({ id })

let latest

const Host = ({ mainTasks, emptyGoals = [], enabled = true, projectId = PROJECT }) => {
    latest = useGoalSectionExit({ projectId, mainTasks, emptyGoals, enabled })
    return null
}

const exitIdsOf = () => Object.keys(latest.exitRunIdByGoalId)
const injectedIdsOf = () => latest.mainTasksWithExits.map(group => group[0])

describe('useGoalSectionExit (AT-2507)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        latest = undefined
        resetGoalTaskCompletionListeners()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const mount = async props => {
        let tree
        await act(async () => {
            tree = renderer.create(<Host {...props} />)
            await Promise.resolve()
        })
        return tree
    }

    const update = async (tree, props) => {
        await act(async () => {
            tree.update(<Host {...props} />)
            await Promise.resolve()
        })
    }

    const complete = async (taskId, goalId = GOAL) => {
        await act(async () => {
            publishGoalTaskCompletion({ projectId: PROJECT, goalId, taskId })
        })
    }

    /** The ordinary shape: a goal with tasks, all of them completed, then dropped by the snapshot. */
    const clearAndDrop = async (tree, tasks) => {
        for (const t of tasks) await complete(t.id)
        await update(tree, { mainTasks: [] })
    }

    describe('a goal that genuinely leaves today', () => {
        it('is held on the board with an exit run', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await clearAndDrop(tree, [task('t1')])

            expect(exitIdsOf()).toEqual([GOAL])
            expect(injectedIdsOf()).toEqual([GOAL])
        })

        it('is re-injected with no tasks under it', async () => {
            // Those rows have already collapsed to zero height under the task row's own exit;
            // re-rendering the completed task would bring a finished row back onto the screen.
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await clearAndDrop(tree, [task('t1')])

            expect(latest.mainTasksWithExits).toEqual([[GOAL, []]])
        })

        it('waits for every task the section had', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1'), task('t2')])] })

            await complete('t1')
            // The snapshot drops the completed task but the goal is still here.
            await update(tree, { mainTasks: [section(GOAL, [task('t2')])] })
            expect(exitIdsOf()).toEqual([])

            await complete('t2')
            await update(tree, { mainTasks: [] })

            expect(exitIdsOf()).toEqual([GOAL])
        })

        it('lets go once the hold expires', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })
            await clearAndDrop(tree, [task('t1')])

            await act(async () => {
                jest.advanceTimersByTime(GOAL_SECTION_HOLD_MS)
            })

            expect(exitIdsOf()).toEqual([])
            expect(latest.mainTasksWithExits).toEqual([])
        })

        it('holds each departing goal separately', async () => {
            const tree = await mount({
                mainTasks: [section(GOAL, [task('t1')]), section(OTHER_GOAL, [task('t2')])],
            })

            await complete('t1')
            await complete('t2', OTHER_GOAL)
            await update(tree, { mainTasks: [] })

            expect(exitIdsOf().sort()).toEqual([GOAL, OTHER_GOAL].sort())
            expect(latest.exitRunIdByGoalId[GOAL]).not.toBe(latest.exitRunIdByGoalId[OTHER_GOAL])
        })
    })

    describe('a goal that does NOT leave', () => {
        /**
         * THE case this design turns on. When a cleared goal is still active for today,
         * `generateOpenTasksArray` moves it to the empty-goals bucket and `MainSection` renders an
         * `EmptyGoal` under the same key — the row stays, with its add-task line. Animating it out
         * would fade a row that is about to be redrawn.
         */
        it('stays silent when the goal only moved to the empty-goals bucket', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await complete('t1')
            await update(tree, { mainTasks: [], emptyGoals: [emptyGoal(GOAL)] })

            expect(exitIdsOf()).toEqual([])
        })

        it('stays silent while it still has tasks', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1'), task('t2')])] })

            await complete('t1')
            await update(tree, { mainTasks: [section(GOAL, [task('t2')])] })

            expect(exitIdsOf()).toEqual([])
        })
    })

    describe('a departure that is not finished work', () => {
        it('says nothing when the last task was moved or deleted rather than completed', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            // No completion is ever published for a task dragged to tomorrow, deleted, reassigned,
            // re-goaled, or handed to the next workflow reviewer.
            await update(tree, { mainTasks: [] })

            expect(exitIdsOf()).toEqual([])
        })

        it('says nothing when only SOME of the section was completed', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1'), task('t2')])] })

            await complete('t1')
            // `t2` left for some other reason, and took the goal with it.
            await update(tree, { mainTasks: [] })

            expect(exitIdsOf()).toEqual([])
        })

        it('forgets a completion that is too old to explain the departure', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })
            await complete('t1')

            await act(async () => {
                jest.advanceTimersByTime(COMPLETION_MEMORY_MS + 1000)
            })
            await update(tree, { mainTasks: [] })

            expect(exitIdsOf()).toEqual([])
        })

        it('ignores a completion in another project', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await act(async () => {
                publishGoalTaskCompletion({ projectId: 'project-b', goalId: GOAL, taskId: 't1' })
            })
            await update(tree, { mainTasks: [] })

            expect(exitIdsOf()).toEqual([])
        })
    })

    describe('standing down', () => {
        it('never subscribes on a list that may not animate', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])], enabled: false })

            await complete('t1')
            await update(tree, { mainTasks: [], enabled: false })

            expect(exitIdsOf()).toEqual([])
        })

        it('takes no hold under reduced motion, so the section leaves as it always did', async () => {
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await clearAndDrop(tree, [task('t1')])

            expect(exitIdsOf()).toEqual([])
            expect(latest.mainTasksWithExits).toEqual([])
        })

        it('hands back the very same list when nothing is leaving', async () => {
            // `MainSection` feeds this to effect dependency lists; a fresh array every render would
            // re-run them, and their `setState`, in a loop.
            const live = [section(GOAL, [task('t1')])]
            const tree = await mount({ mainTasks: live })
            expect(latest.mainTasksWithExits).toBe(live)

            await update(tree, { mainTasks: live })
            expect(latest.mainTasksWithExits).toBe(live)
        })

        it('drops its timers when the list unmounts', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })
            await clearAndDrop(tree, [task('t1')])

            await act(async () => {
                tree.unmount()
                jest.advanceTimersByTime(GOAL_SECTION_HOLD_MS * 2)
            })
            // A timer surviving the unmount would `setState` on a dead component, which React
            // reports as a warning and this assertion would not otherwise catch.
        })
    })
})
