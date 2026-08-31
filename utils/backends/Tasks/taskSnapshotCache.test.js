import { getTaskFromLoadedTaskMaps } from './taskSnapshotCache'

describe('getTaskFromLoadedTaskMaps', () => {
    test('uses the loaded subtask map before Firestore cache or network reads', () => {
        const subtask = { id: 'subtask-1', dueDate: 100 }
        const state = {
            openSubtasksMap: { project: { 'subtask-1': subtask } },
            openTasksMap: { project: { 'subtask-1': { id: 'stale-copy', dueDate: 50 } } },
        }

        expect(getTaskFromLoadedTaskMaps(state, 'project', 'subtask-1')).toBe(subtask)
    })

    test('falls back to the loaded main-task map', () => {
        const task = { id: 'task-1', dueDate: 200 }
        const state = { openTasksMap: { project: { 'task-1': task } } }

        expect(getTaskFromLoadedTaskMaps(state, 'project', 'task-1')).toBe(task)
    })

    test('returns null when the task has not been loaded', () => {
        expect(getTaskFromLoadedTaskMaps({}, 'project', 'missing')).toBeNull()
    })
})
