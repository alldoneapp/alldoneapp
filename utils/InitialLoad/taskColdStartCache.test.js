import {
    TASK_COLD_START_CACHE_MAX_AGE_MS,
    TASK_COLD_START_CACHE_SCHEMA_VERSION,
    buildTaskColdStartSnapshot,
    getRestorableTaskColdStartSnapshot,
    getTaskBearingProjectIndexes,
} from './taskColdStartCache'

const todayWithTasks = amount => [['0', amount, 0, [], [], [], [], [], [], [], [], []]]

const buildState = () => ({
    loggedUser: { uid: 'user-1' },
    currentUser: { uid: 'user-1' },
    loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }],
    openTasksStore: {
        'p1user-1': todayWithTasks(2),
        'p2user-1': [],
    },
    subtaskByTaskStore: { 'p1user-1': { task: [{ id: 'subtask' }] } },
    openTasksMap: { p1: { task: { id: 'task' } } },
    openSubtasksMap: { p1: { subtask: { id: 'subtask' } } },
    openMilestonesByProjectInTasks: { p1: [{ id: 'open-milestone' }] },
    doneMilestonesByProjectInTasks: { p1: [{ id: 'done-milestone' }] },
    goalsByProjectInTasks: { p1: { goal: { id: 'goal' } } },
    thereAreNotTasksInFirstDay: { 'p1user-1': false, 'p2user-1': true },
    thereAreHiddenNotMainTasks: { 'p1user-1': true },
})

describe('taskColdStartCache projection', () => {
    it('stores render data for both task-bearing and empty projects', () => {
        const snapshot = buildTaskColdStartSnapshot(buildState(), 1000)

        expect(snapshot).toEqual(
            expect.objectContaining({
                schemaVersion: TASK_COLD_START_CACHE_SCHEMA_VERSION,
                userId: 'user-1',
                currentUserId: 'user-1',
                savedAt: 1000,
            })
        )
        expect(snapshot.projects.p1).toEqual(
            expect.objectContaining({
                openTasks: todayWithTasks(2),
                openTasksMap: { task: { id: 'task' } },
                openMilestones: [{ id: 'open-milestone' }],
                doneMilestones: [{ id: 'done-milestone' }],
                goalsById: { goal: { id: 'goal' } },
                thereAreHiddenNotMainTasks: true,
            })
        )
        expect(snapshot.projects.p2).toEqual(
            expect.objectContaining({ openTasks: [], thereAreNotTasksInFirstDay: true })
        )
    })

    it('never caches an assistant or another selected user as the logged-in user projection', () => {
        const state = buildState()
        state.currentUser.uid = 'assistant-1'

        expect(buildTaskColdStartSnapshot(state)).toBeNull()
    })

    it('accepts the previous-day window, prunes lost projects, and rejects stale data', () => {
        const now = 1_000_000_000
        const snapshot = buildTaskColdStartSnapshot(buildState(), now - TASK_COLD_START_CACHE_MAX_AGE_MS)

        expect(getRestorableTaskColdStartSnapshot(snapshot, 'user-1', ['p1'], now).projects).toEqual({
            p1: snapshot.projects.p1,
        })
        expect(getRestorableTaskColdStartSnapshot(snapshot, 'other-user', ['p1'], now)).toBeNull()
        expect(
            getRestorableTaskColdStartSnapshot({ ...snapshot, savedAt: snapshot.savedAt - 1 }, 'user-1', ['p1'], now)
        ).toBeNull()
    })

    it('rejects task rows that cannot render without their goal-order metadata', () => {
        const now = 1_000_000_000
        const snapshot = buildTaskColdStartSnapshot(buildState(), now)
        delete snapshot.projects.p1.openMilestones

        expect(getRestorableTaskColdStartSnapshot(snapshot, 'user-1', ['p1'], now)).toBeNull()
    })

    it('finds task-bearing project positions without changing display order', () => {
        const state = buildState()

        expect(getTaskBearingProjectIndexes(['p2', 'p1'], state.openTasksStore, 'user-1')).toEqual([1])
    })
})
