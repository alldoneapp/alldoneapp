import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'

import useGoalSectionExit, {
    COMPLETION_MEMORY_MS,
    GOAL_SECTION_HOLD_MS,
    keepDepartingGoalsSortable,
} from './useGoalSectionExit'
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

    it('does not make the parent goal participate when its final task is postponed', async () => {
        const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

        // A postpone has no completion signal. When its snapshot removes the final task, the row
        // may close naturally but the goal wrapper must not be held or receive an exit run.
        await update(tree, { mainTasks: [] })

        expect(exitIdsOf()).toEqual([])
        expect(latest.mainTasksWithExits).toEqual([])
    })

    /**
     * AT-2521 — the departure as it ACTUALLY arrives in production, which is in two snapshots and
     * not one.
     *
     * A goal only ever leaves today's list because its `progress` reached 100 (`isNotCompleted` in
     * `openTasks.js`); nothing else about completing a task removes a goal from the day. But
     * `progress` lives on the GOAL document and is delivered by the goals listener, while the task
     * removal is delivered by the tasks listener — and the goal write is CAUSED by the task write,
     * so the task snapshot lands first essentially every time.
     *
     * So the real sequence is: the section empties, the goal spends a beat in the empty-goals bucket
     * as a still-active goal, and only then leaves. AT-2507 read that middle frame as "this goal is
     * staying" and forgot the section, so the departure one snapshot later was invisible to it and
     * the goal popped away exactly as before. Every test above passes with that defect present,
     * because they all model the departure as a single step.
     */
    describe('a goal that leaves through the empty-goals bucket (the production ordering)', () => {
        const clearThenLeave = async tree => {
            await complete('t1')
            // 1. The tasks listener answers first: no tasks left, but the goal is still active today.
            await update(tree, { mainTasks: [], emptyGoals: [emptyGoal(GOAL)] })
            // 2. The goals listener answers: progress is 100, so the goal leaves the day for real.
            await update(tree, { mainTasks: [], emptyGoals: [] })
        }

        it('still gets an exit run', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await clearThenLeave(tree)

            expect(exitIdsOf()).toEqual([GOAL])
        })

        /**
         * Held in the shape it was LAST RENDERED IN. The row on screen at that moment is an
         * `EmptyGoal`, already mounted and already measured, so holding it there lets that very node
         * play the exit. Re-injecting it as a main section instead would swap the component for a
         * freshly mounted one whose height has never been measured — it would fade, then pop its
         * full height away at the end of the hold, which is the jump this task is about.
         */
        it('is held as an empty goal rather than re-injected as a task section', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await clearThenLeave(tree)

            expect(latest.emptyGoalsWithExits.map(goal => goal.id)).toEqual([GOAL])
            expect(latest.mainTasksWithExits).toEqual([])
        })

        it('lets go once the hold expires', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })
            await clearThenLeave(tree)

            await act(async () => {
                jest.advanceTimersByTime(GOAL_SECTION_HOLD_MS)
            })

            expect(exitIdsOf()).toEqual([])
            expect(latest.emptyGoalsWithExits).toEqual([])
        })

        it('says nothing when the goal left the bucket without its work being finished', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            // `t1` was dragged to tomorrow, so the goal emptied and then dropped out of today
            // because its reminder date moved — no completion was ever published.
            await update(tree, { mainTasks: [], emptyGoals: [emptyGoal(GOAL)] })
            await update(tree, { mainTasks: [], emptyGoals: [] })

            expect(exitIdsOf()).toEqual([])
        })

        it('says nothing once the completion is too old to explain the departure', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await complete('t1')
            await update(tree, { mainTasks: [], emptyGoals: [emptyGoal(GOAL)] })
            // The goal sat there as an empty goal all morning and left for some other reason.
            await act(async () => {
                jest.advanceTimersByTime(COMPLETION_MEMORY_MS + 1000)
            })
            await update(tree, { mainTasks: [], emptyGoals: [] })

            expect(exitIdsOf()).toEqual([])
        })

        /**
         * The goal came back — a task was added to it, or the completed one was reopened — before
         * the goal document caught up. Nothing is leaving, and the section must be judged fresh
         * against whatever it holds now.
         */
        it('forgets the pending departure when tasks come back under the goal', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await complete('t1')
            await update(tree, { mainTasks: [], emptyGoals: [emptyGoal(GOAL)] })
            await update(tree, { mainTasks: [section(GOAL, [task('t2')])], emptyGoals: [] })
            await update(tree, { mainTasks: [], emptyGoals: [] })

            expect(exitIdsOf()).toEqual([])
        })

        it('hands back the very same empty-goals list when nothing is leaving', async () => {
            const live = [emptyGoal(GOAL)]
            const tree = await mount({ mainTasks: [], emptyGoals: live })

            expect(latest.emptyGoalsWithExits).toBe(live)
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

        /**
         * AT-2521 — and it must STAY silent, rather than deciding the goal is gone, because the very
         * next snapshot may put tasks back under it.
         */
        it('stays silent when the goal sits in the empty-goals bucket for several renders', async () => {
            const tree = await mount({ mainTasks: [section(GOAL, [task('t1')])] })

            await complete('t1')
            await update(tree, { mainTasks: [], emptyGoals: [emptyGoal(GOAL)] })
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

        it('keeps a departing goal sortable, so the hold can put it back where it was', () => {
            // `MainSection` drops a section whose goal has no sort position, so a goal in the
            // BACKLOG milestone — the one branch that refuses a completed goal a slot — would have
            // its exit computed and never drawn.
            const goalsById = { [GOAL]: { id: GOAL, progress: 100, dynamicProgress: 100 } }

            const patched = keepDepartingGoalsSortable(goalsById, { [GOAL]: 1 })

            expect(patched[GOAL].progress).toBe(99)
            expect(patched[GOAL].dynamicProgress).toBe(99)
            expect(goalsById[GOAL].progress).toBe(100)
        })

        it('preserves the DYNAMIC_PERCENT sentinel, which says which number counts', () => {
            const goalsById = { [GOAL]: { id: GOAL, progress: 'DYNAMIC_PERCENT', dynamicProgress: 100 } }

            const patched = keepDepartingGoalsSortable(goalsById, { [GOAL]: 1 })

            expect(patched[GOAL].progress).toBe('DYNAMIC_PERCENT')
            expect(patched[GOAL].dynamicProgress).toBe(99)
        })

        it('hands back the very same goals map when nothing is departing', () => {
            const goalsById = { [GOAL]: { id: GOAL, progress: 100, dynamicProgress: 100 } }

            expect(keepDepartingGoalsSortable(goalsById, {})).toBe(goalsById)
            expect(keepDepartingGoalsSortable(goalsById, { [OTHER_GOAL]: 1 })).toBe(goalsById)
        })

        it('leaves an unfinished departing goal alone', () => {
            // It already has a position; only a completed goal is refused one.
            const goalsById = { [GOAL]: { id: GOAL, progress: 40, dynamicProgress: 40 } }

            expect(keepDepartingGoalsSortable(goalsById, { [GOAL]: 1 })).toBe(goalsById)
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
