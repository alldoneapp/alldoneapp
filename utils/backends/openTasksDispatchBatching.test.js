/**
 * @jest-environment jsdom
 *
 * AT-2337 - "All projects -> Tasks" is slow.
 *
 * The all-projects board mounts one independent block per project (a heavy
 * dogfooding account renders ~78) and each block runs its own Firestore
 * watchers. Publishing ONE project's tasks used to walk through 5-7 separate
 * `store.dispatch` calls, and react-redux 9 re-runs the selector of every
 * mounted `useSelector` on every one of them. The board has thousands of
 * selectors, so the cost of loading it is `dispatches x subscribers` - and the
 * dispatch count was the half we could cut without changing the rendered
 * output.
 *
 * These tests drive the REAL redux store (with the real `@manaflair/redux-batch`
 * enhancer) and count subscriber notifications, so a regression that re-splits
 * the pipeline back into individual dispatches fails here instead of only
 * showing up as a slow board.
 */

import store from '../../redux/store'
import { updateOpTasks, updateAndFilterTasksTasks, ACTIVE_GOALS_INDEX, AMOUNT_TASKS_INDEX } from './openTasks'

// A single day tuple with one visible main task, shaped like generateOpenTasksArray builds it:
// [DATE, AMOUNT, ESTIMATION, MAIN, MENTION, SUGGESTED, WORKFLOW, OBSERVED, STREAM_AND_USER, ACTIVE_GOALS, EMPTY]
const buildDayWithOneTask = () => [
    '0',
    1,
    0,
    [['goal-1', [{ id: 'task-1', name: 'a task' }]]],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
]

const countNotifications = run => {
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
        notifications++
    })
    try {
        run()
    } finally {
        unsubscribe()
    }
    return notifications
}

describe('open-tasks publish pipeline dispatch batching (AT-2337)', () => {
    it("publishes one project's tasks with a single store notification", () => {
        const notifications = countNotifications(() =>
            updateOpTasks('project-1', 'project-1user-1', [buildDayWithOneTask()], true, null, false)
        )

        expect(notifications).toBe(1)
    })

    it('costs one notification per project, not one per action, across many projects', () => {
        const projectIds = Array.from({ length: 25 }, (_, index) => `project-${index}`)

        const notifications = countNotifications(() => {
            projectIds.forEach(projectId => {
                updateOpTasks(projectId, `${projectId}user-1`, [buildDayWithOneTask()], true, null, false)
            })
        })

        // Before batching this was ~6 per project. Anything above 1:1 means the
        // pipeline started leaking individual dispatches again.
        expect(notifications).toBe(projectIds.length)
    })

    it('still writes every slice the board reads, with the same values', () => {
        const instanceKey = 'project-slices-user-1'
        updateOpTasks('project-slices', instanceKey, [buildDayWithOneTask()], true, null, false)

        const state = store.getState()
        // Batching must not drop or reorder any of the actions the board depends on.
        expect(state.openTasksStore[instanceKey]).toHaveLength(1)
        expect(state.filteredOpenTasksStore[instanceKey]).toHaveLength(1)
        expect(state.thereAreNotTasksInFirstDay[instanceKey]).toBe(false)
        expect(state.thereAreHiddenNotMainTasks[instanceKey]).toBe(false)
        expect(state.initialLoadingEndOpenTasks[instanceKey]).toBe(true)
        // A zero amount deletes the per-project key (see the reducer), so assert on
        // the running total the all-projects empty-inbox picture actually reads.
        expect(state.todayEmptyGoalsTotalAmountInOpenTasksView['project-slices']).toBeUndefined()
    })

    it('still delivers the today-empty-goals count inside the batch', () => {
        const instanceKey = 'project-goals-user-1'
        const dayWithEmptyGoals = ['0', 1, 0, [['goal-1', [{ id: 'task-1' }]]], [], [], [], [], [], ['g1', 'g2'], []]

        const before = store.getState().todayEmptyGoalsTotalAmountInOpenTasksView.total
        const notifications = countNotifications(() =>
            updateOpTasks('project-goals', instanceKey, [dayWithEmptyGoals], true, null, false)
        )

        expect(notifications).toBe(1)
        const state = store.getState()
        expect(state.todayEmptyGoalsTotalAmountInOpenTasksView['project-goals']).toBe(2)
        expect(state.todayEmptyGoalsTotalAmountInOpenTasksView.total).toBe(before + 2)
    })

    it('reports an empty project as having no tasks in the first day', () => {
        const instanceKey = 'project-empty-user-1'
        const emptyDay = ['0', 0, 0, [], [], [], [], [], [], [], []]

        const notifications = countNotifications(() =>
            updateOpTasks('project-empty', instanceKey, [emptyDay], false, null, false)
        )

        expect(notifications).toBe(1)
        const state = store.getState()
        expect(state.thereAreNotTasksInFirstDay[instanceKey]).toBe(true)
        expect(state.initialLoadingEndObservedTasks[instanceKey]).toBe(true)
    })

    it('keeps the selected-project path (no all-projects transform) at one notification', () => {
        const instanceKey = 'project-selected-user-1'
        const day = buildDayWithOneTask()

        const notifications = countNotifications(() =>
            updateOpTasks('project-selected', instanceKey, [day], true, null, true)
        )

        expect(notifications).toBe(1)
        // inSelectedProject=true keeps the raw tuple, including the sections that
        // taskToShowInAllProjects blanks out.
        expect(store.getState().openTasksStore[instanceKey][0][AMOUNT_TASKS_INDEX]).toBe(day[AMOUNT_TASKS_INDEX])
        expect(store.getState().openTasksStore[instanceKey][0][ACTIVE_GOALS_INDEX]).toEqual([])
    })

    it('batches updateAndFilterTasksTasks when a caller opens no batch of its own', () => {
        // Called directly (not from a snapshot handler) it must still be correct;
        // it simply costs its own two notifications rather than joining one.
        const instanceKey = 'project-direct-user-1'
        const notifications = countNotifications(() =>
            updateAndFilterTasksTasks(instanceKey, [buildDayWithOneTask()], 'project-direct')
        )

        expect(notifications).toBeLessThanOrEqual(2)
        expect(store.getState().filteredOpenTasksStore[instanceKey]).toHaveLength(1)
    })
})
