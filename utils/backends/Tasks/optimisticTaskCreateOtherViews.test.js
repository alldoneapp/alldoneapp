/**
 * AT-2342 - the same instant-insert contract for the two full-rebuild task watchers:
 * the Goal detailed view (`watchOpenGoalTasks`) and My Day (`watchTasksToAttend`).
 *
 * Both rebuild their entire output from a document list on every snapshot, so the optimistic
 * task is just one more document in that list - and reconciliation is a matter of dropping the
 * pending copy once the real snapshot carries the same id. These tests drive the real watchers
 * with a fake Firestore and assert both halves: the task shows up instantly, and it is still
 * listed exactly once after the echo.
 */

const mockDispatch = jest.fn()

const mockState = {
    loggedUser: { uid: 'user-1', isAnonymous: false },
    currentUser: { uid: 'user-1' },
}

jest.mock('../../../redux/store', () => ({
    dispatch: (...args) => mockDispatch(...args),
    getState: () => mockState,
}))

jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    BACKLOG_DATE_STRING: 'Someday',
    OPEN_STEP: 'open',
}))

jest.mock('../../EstimationHelper', () => ({
    ESTIMATION_0_MIN: 0,
    getEstimationRealValue: jest.fn((projectId, estimation) => estimation),
}))

const listeners = []

const buildQuery = () => {
    const query = {
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        onSnapshot: handler => {
            listeners.push(handler)
            return () => {}
        },
    }
    return query
}

jest.mock('../firestore', () => ({
    getDb: () => ({ collection: () => buildQuery() }),
    globalWatcherUnsub: {},
    mapTaskData: (id, data) => ({ id, ...data }),
}))

import { matchesOpenGoalTasksQuery, watchOpenGoalTasks } from './openGoalTasks'
import { matchesTasksToAttendQuery, watchTasksToAttend } from './myDayTasks'
import {
    publishOptimisticTaskCreated,
    publishOptimisticTaskSettled,
    resetOptimisticTaskCreates,
} from './optimisticTaskCreate'

const PROJECT_ID = 'project-1'
const GOAL_ID = 'goal-1'

const snapshotOf = docs => ({
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: callback => docs.forEach(callback),
})

const fakeDoc = (id, data) => ({ id, data: () => data })

const allDispatched = type =>
    mockDispatch.mock.calls.map(call => call[0]).filter(action => action && action.type === type)

const lastDispatched = type => {
    const matching = allDispatched(type)
    return matching[matching.length - 1]
}

describe('AT-2342 optimistic insert in the Goal detailed view', () => {
    const goalTask = (overrides = {}) => ({
        name: 'buy milk',
        done: false,
        parentId: null,
        completed: null,
        parentGoalId: GOAL_ID,
        isPublicFor: [0],
        dueDate: Date.now(),
        estimations: { open: 0 },
        sortIndex: 100,
        genericData: null,
        suggestedBy: null,
        calendarData: null,
        priority: 'none',
        ...overrides,
    })

    /** All task ids across every day tuple of the goal list. */
    const goalTaskIds = () => {
        const action = lastDispatched('Set goal open tasks data')
        if (!action) return null
        // [date, amount, estimation, MAIN, MENTION, SUGGESTED]
        return action.goalOpenTasksData.flatMap(day => day[3].map(task => task.id))
    }

    beforeEach(() => {
        listeners.length = 0
        mockDispatch.mockClear()
        resetOptimisticTaskCreates()
        watchOpenGoalTasks(PROJECT_ID, GOAL_ID, 'watcher-key')
        listeners[0](snapshotOf([]))
        mockDispatch.mockClear()
    })

    it('renders a just-created goal task without waiting for a snapshot', () => {
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', goalTask())

        expect(goalTaskIds()).toEqual(['task-1'])
    })

    it('lists it exactly once once the real snapshot carries it', () => {
        const raw = goalTask()
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        listeners[0](snapshotOf([fakeDoc('task-1', raw)]))

        expect(goalTaskIds()).toEqual(['task-1'])
    })

    it('drops the pending copy for good, so a later unrelated snapshot cannot resurrect it', () => {
        const raw = goalTask()
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        listeners[0](snapshotOf([fakeDoc('task-1', raw)]))
        // The task is then moved to another goal, so it leaves this list.
        listeners[0](snapshotOf([]))

        expect(goalTaskIds()).toEqual([])
    })

    it('waits for the first snapshot rather than publishing a goal that holds only the new task', () => {
        // Re-mount so nothing has arrived yet.
        listeners.length = 0
        resetOptimisticTaskCreates()
        watchOpenGoalTasks(PROJECT_ID, GOAL_ID, 'watcher-key')
        mockDispatch.mockClear()

        const raw = goalTask()
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        expect(goalTaskIds()).toBeNull()

        // ...and it is not dropped either: the first snapshot renders it with everything else.
        listeners[0](snapshotOf([fakeDoc('task-2', goalTask({ sortIndex: 50 }))]))
        expect(goalTaskIds().sort()).toEqual(['task-1', 'task-2'])
    })

    it('ignores a task created for a different goal', () => {
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', goalTask({ parentGoalId: 'goal-2' }))

        expect(goalTaskIds()).toBeNull()
    })

    it('ignores a subtask, which this list never shows', () => {
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', goalTask({ parentId: 'parent-1' }))

        expect(goalTaskIds()).toBeNull()
    })

    /**
     * AT-2500 - the pending copy is only ever purged by an id APPEARING in a snapshot, so a task
     * edited out of this query before its create was echoed would be merged into every rebuild
     * for the lifetime of the watcher. The write's server ack is what says no echo is coming.
     */
    describe('AT-2500 a task moved out of this list before its create was echoed', () => {
        it('drops a pending copy the settled document puts outside this goal', () => {
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', goalTask())
            expect(goalTaskIds()).toEqual(['task-1'])

            // Re-assigned to another goal before the echo, so this query never sees it. The
            // settled document is what says so - settlement on its own means only "the server has
            // it", which for this query is still true of a task that moved to another goal.
            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', goalTask({ parentGoalId: 'goal-2' }))

            expect(goalTaskIds()).toEqual([])
        })

        it('leaves a task the snapshot did carry exactly where it is', () => {
            const raw = goalTask()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
            listeners[0](snapshotOf([fakeDoc('task-1', raw)]))

            publishOptimisticTaskSettled(PROJECT_ID, 'task-1')

            expect(goalTaskIds()).toEqual(['task-1'])
        })

        it('settling an unknown task publishes nothing at all', () => {
            mockDispatch.mockClear()
            publishOptimisticTaskSettled(PROJECT_ID, 'never-seen')

            expect(lastDispatched('Set goal open tasks data')).toBeUndefined()
        })

        /**
         * AT-2500 follow-up - the pending copy used to be dropped on the ack alone, which made
         * every ordinary create blink: this query filters on `readerIds`, a server-derived field
         * the client may not write, so a just-created task is invisible to it until the access
         * projection lands - always well after the ack.
         */
        it('never renders a frame without the task, from the create to the echo', () => {
            const raw = goalTask()
            mockDispatch.mockClear()

            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', raw)
            listeners[0](snapshotOf([fakeDoc('task-1', raw)]))

            const states = allDispatched('Set goal open tasks data').map(action =>
                action.goalOpenTasksData.flatMap(day => day[3].map(task => task.id))
            )
            expect(states.length).toBeGreaterThan(0)
            expect(states).not.toContainEqual([])
            states.forEach(ids => expect(ids).toEqual(['task-1']))
        })

        it('refreshes the pending copy in place when the settled document still belongs', () => {
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', goalTask())

            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', goalTask({ name: 'buy oat milk' }))

            expect(goalTaskIds()).toEqual(['task-1'])
            const rendered = lastDispatched('Set goal open tasks data').goalOpenTasksData.flatMap(day => day[3])
            expect(rendered).toHaveLength(1)
            expect(rendered[0].name).toBe('buy oat milk')
        })

        it('keeps the pending copy when settlement carries no document', () => {
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', goalTask())

            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', null)

            expect(goalTaskIds()).toEqual(['task-1'])
        })
    })

    describe('matchesOpenGoalTasksQuery', () => {
        const allow = [0, 'user-1']

        it('accepts a visible open task of this goal', () => {
            expect(matchesOpenGoalTasksQuery(goalTask(), GOAL_ID, allow)).toBe(true)
        })

        it('keys on `done`, not on the `inDone` the open board uses', () => {
            expect(matchesOpenGoalTasksQuery(goalTask({ done: true }), GOAL_ID, allow)).toBe(false)
            expect(matchesOpenGoalTasksQuery(goalTask({ inDone: true }), GOAL_ID, allow)).toBe(true)
        })

        it('rejects a task this user cannot see', () => {
            expect(matchesOpenGoalTasksQuery(goalTask({ isPublicFor: ['user-2'] }), GOAL_ID, allow)).toBe(false)
        })
    })
})

describe('AT-2342 optimistic insert in My Day', () => {
    // `__mocks__/moment.js` pins Date.now() for the whole suite, so derive "today" from it
    // rather than from the real clock - otherwise the two disagree by seven years.
    const endOfDay = () => {
        const date = new Date(Date.now())
        date.setHours(23, 59, 59, 999)
        return date.valueOf()
    }

    const myDayTask = (overrides = {}) => ({
        name: 'buy milk',
        inDone: false,
        currentReviewerId: 'user-1',
        dueDate: Date.now(),
        parentId: null,
        estimations: { open: 0 },
        sortIndex: 100,
        ...overrides,
    })

    const myDayTaskIds = () => {
        const action = lastDispatched('Set my day all today tasks')
        return action ? action.tasks.map(task => task.id) : null
    }

    beforeEach(async () => {
        listeners.length = 0
        mockDispatch.mockClear()
        resetOptimisticTaskCreates()
        await watchTasksToAttend(PROJECT_ID, 'user-1', 'watcher-key')
        listeners[0](snapshotOf([]))
        mockDispatch.mockClear()
    })

    it('renders a just-created task without waiting for a snapshot', () => {
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', myDayTask())

        expect(myDayTaskIds()).toEqual(['task-1'])
    })

    it('lists it exactly once once the real snapshot carries it', () => {
        const raw = myDayTask()
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
        listeners[0](snapshotOf([fakeDoc('task-1', raw)]))

        expect(myDayTaskIds()).toEqual(['task-1'])
    })

    it('stamps the project on the optimistic task, as My Day needs to group by project', () => {
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', myDayTask())

        expect(lastDispatched('Set my day all today tasks').tasks[0].projectId).toBe(PROJECT_ID)
    })

    it('ignores a task assigned to somebody else', () => {
        publishOptimisticTaskCreated(PROJECT_ID, 'task-1', myDayTask({ currentReviewerId: 'user-2' }))

        expect(myDayTaskIds()).toBeNull()
    })

    /**
     * AT-2500 - My Day's query IS `dueDate <= endOfDay`, so postponing a task to tomorrow always
     * takes it out of this list. Done before the create was echoed, the pending copy was never
     * purged and the task stayed in My Day, showing today, until the watcher restarted.
     */
    describe('AT-2500 a task postponed before its create was echoed', () => {
        it('drops a pending copy the settled document postpones out of today', () => {
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', myDayTask())
            expect(myDayTaskIds()).toEqual(['task-1'])

            const tomorrow = Date.now() + 24 * 60 * 60 * 1000
            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', myDayTask({ dueDate: tomorrow }))

            expect(myDayTaskIds()).toEqual([])
        })

        it('leaves a task the snapshot did carry exactly where it is', () => {
            const raw = myDayTask()
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
            listeners[0](snapshotOf([fakeDoc('task-1', raw)]))

            publishOptimisticTaskSettled(PROJECT_ID, 'task-1')

            expect(myDayTaskIds()).toEqual(['task-1'])
        })

        it('settling an unknown task publishes nothing at all', () => {
            mockDispatch.mockClear()
            publishOptimisticTaskSettled(PROJECT_ID, 'never-seen')

            expect(lastDispatched('Set my day all today tasks')).toBeUndefined()
        })

        /**
         * AT-2500 follow-up - My Day is where a task is most often added, and it flickered on
         * every single create: the ack always precedes the first snapshot here, because this query
         * filters on the server-derived `readerIds`.
         */
        it('never renders a frame without the task, from the create to the echo', () => {
            const raw = myDayTask()
            mockDispatch.mockClear()

            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', raw)
            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', raw)
            listeners[0](snapshotOf([fakeDoc('task-1', raw)]))

            const states = allDispatched('Set my day all today tasks').map(action => action.tasks.map(task => task.id))
            expect(states.length).toBeGreaterThan(0)
            expect(states).not.toContainEqual([])
            states.forEach(ids => expect(ids).toEqual(['task-1']))
        })

        it('refreshes the pending copy in place when the settled document still belongs', () => {
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', myDayTask())

            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', myDayTask({ name: 'buy oat milk' }))

            expect(myDayTaskIds()).toEqual(['task-1'])
            expect(lastDispatched('Set my day all today tasks').tasks[0].name).toBe('buy oat milk')
        })

        it('keeps the pending copy when settlement carries no document', () => {
            publishOptimisticTaskCreated(PROJECT_ID, 'task-1', myDayTask())

            publishOptimisticTaskSettled(PROJECT_ID, 'task-1', null)

            expect(myDayTaskIds()).toEqual(['task-1'])
        })
    })

    describe('matchesTasksToAttendQuery', () => {
        it('accepts an open task of mine due today', () => {
            expect(matchesTasksToAttendQuery(myDayTask(), 'user-1', endOfDay())).toBe(true)
        })

        it('rejects a task due after today - My Day is today only', () => {
            const nextWeek = Date.now() + 7 * 24 * 60 * 60 * 1000
            expect(matchesTasksToAttendQuery(myDayTask({ dueDate: nextWeek }), 'user-1', endOfDay())).toBe(false)
        })

        it('rejects a task already in done', () => {
            expect(matchesTasksToAttendQuery(myDayTask({ inDone: true }), 'user-1', endOfDay())).toBe(false)
        })
    })
})
