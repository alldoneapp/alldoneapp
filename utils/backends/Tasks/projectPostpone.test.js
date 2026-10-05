import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { postponeProjectTasks } from './projectPostpone'
import { runHttpsCallableFunction } from '../firestore'
import {
    clearProjectPostpone,
    getProjectPostpone,
    projectTaskPreview,
    PROJECT_POSTPONE_ECHO_TIMEOUT_MS,
} from './optimisticProjectPostpone'
import TasksList from '../../../components/TaskListView/OpenTasksView/TasksList'
import { reverseUndoAction } from '../../undo/undoActions'

let mockState
let mockRequestNumber = 0
const mockSubscribers = new Set()
const mockReverse = jest.fn()
jest.mock('../../../redux/store', () => ({
    getState: () => mockState,
    subscribe: listener => {
        mockSubscribers.add(listener)
        return () => mockSubscribers.delete(listener)
    },
}))
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../firestore', () => ({ runHttpsCallableFunction: jest.fn() }))
jest.mock('uuid/v4', () => () => `request-${++mockRequestNumber}`)
jest.mock('firebase/compat/app', () => ({ app: () => ({ functions: () => ({ httpsCallable: () => mockReverse }) }) }))
jest.mock('../../connectionState', () => ({ isBrowserOffline: () => false }))
jest.mock('../../../components/DragSystem/DroppableTaskList', () => 'DroppableTaskList')
jest.mock('../../../components/TaskListView/ParentTaskContainer', () => 'ParentTaskContainer')
jest.mock('../openTasks', () => ({ MAIN_TASK_INDEX: 3, DATE_TASK_INDEX: 0, TODAY_DATE: 'today' }))
jest.mock('../../TaskPriority', () => ({ sortTasksByPriority: tasks => tasks }))
jest.mock('../../editingGuard', () => ({ useIsUserEditing: () => false }))

const now = new Date('2026-10-05T10:00:00Z').valueOf()
const tomorrow = moment(now).add(1, 'day').valueOf()
const task = { id: 't1', dueDate: now, currentReviewerId: 'u1', inDone: false, done: false, sortIndex: 1 }
const goalTask = { ...task, id: 'g1-task', parentGoalId: 'goal-1', dueDate: now - 86400000 }
const foreign = { ...task, id: 'foreign', currentReviewerId: 'u2' }
const future = { ...task, id: 'future', dueDate: tomorrow }
const done = { ...task, id: 'done', done: true }
const tasks = [task, goalTask, foreign, future, done]
const publishTasks = next => {
    mockState.openTasksMap.p1 = Object.fromEntries(next.map(task => [task.id, task]))
    mockSubscribers.forEach(listener => listener())
}
const deferred = () => {
    let resolve, reject
    const promise = new Promise((r, j) => {
        resolve = r
        reject = j
    })
    return { promise, resolve, reject }
}
const mountRows = () =>
    renderer.create(<TasksList projectId="p1" dateIndex={0} taskList={tasks} taskListIndex={3} instanceKey="p1u1" />)
const rowIds = tree => tree.root.findAllByType('ParentTaskContainer').map(row => row.props.task.id)

beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(now)
    jest.clearAllMocks()
    mockState = {
        loggedUser: { uid: 'u1' },
        openTasksMap: { p1: Object.fromEntries(tasks.map(task => [task.id, task])) },
        openSubtasksMap: {},
        subtaskByTaskStore: {},
        filteredOpenTasksStore: { p1u1: [['today']] },
    }
    runHttpsCallableFunction.mockResolvedValue({ updatedTaskCount: 2 })
    mockReverse.mockResolvedValue({ data: { success: true } })
})
afterEach(() => {
    jest.runOnlyPendingTimers()
    expect(mockSubscribers.size).toBe(0)
    jest.useRealTimers()
})

it('sends one authenticated callable, a request id and local timezone without a browser selection', async () => {
    await postponeProjectTasks('p1', tomorrow)
    expect(runHttpsCallableFunction).toHaveBeenLastCalledWith('postponeProjectTasksWithUndoSecondGen', {
        projectId: 'p1',
        requestId: expect.any(String),
        mode: 'date',
        date: tomorrow,
        timezoneOffset: moment().utcOffset(),
    })
})

it('lets the cloud derive auto dates without sending tasks', async () => {
    await postponeProjectTasks('p1', undefined, 'auto')
    expect(runHttpsCallableFunction).toHaveBeenLastCalledWith('postponeProjectTasksWithUndoSecondGen', {
        projectId: 'p1',
        requestId: expect.any(String),
        mode: 'auto',
        timezoneOffset: moment().utcOffset(),
    })
})

it.each([
    ['date', tomorrow],
    ['auto', undefined],
    ['date', Number.MAX_SAFE_INTEGER],
])('updates rendered own rows while %s persistence is still pending', async (mode, date) => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValue(backend.promise)
    let tree
    act(() => {
        tree = mountRows()
    })
    expect(rowIds(tree)).toEqual(tasks.map(task => task.id))
    let pending
    act(() => {
        pending = postponeProjectTasks('p1', date, mode)
    })
    expect(rowIds(tree)).toEqual(['foreign', 'future', 'done'])
    expect(getProjectPostpone('p1', 'u1').saving).toBe(true)
    await act(async () => {
        backend.resolve({ updatedTaskCount: 2 })
        await pending
    })
    expect(rowIds(tree)).toEqual(['foreign', 'future', 'done'])
    expect(getProjectPostpone('p1', 'u1').saving).toBe(false)
    act(() => {
        tree.unmount()
    })
})

it('restores rows on rejection and allows a fresh retry', async () => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(backend.promise)
    let tree, pending
    act(() => {
        tree = mountRows()
        pending = postponeProjectTasks('p1', tomorrow)
    })
    const rejection = expect(pending).rejects.toMatchObject({ code: 'offline' })
    await act(async () => {
        backend.reject(Object.assign(new Error('offline'), { code: 'offline' }))
        await rejection
    })
    expect(rowIds(tree)).toEqual(tasks.map(task => task.id))
    expect(getProjectPostpone('p1', 'u1')).toBeUndefined()
    await act(async () => {
        await postponeProjectTasks('p1', tomorrow)
    })
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    act(() => {
        tree.unmount()
    })
})

it('guards duplicate selections across popups for the same actor/project', async () => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(backend.promise)
    const pending = postponeProjectTasks('p1', tomorrow)
    expect(postponeProjectTasks('p1', Number.MAX_SAFE_INTEGER)).toBe(pending)
    await Promise.resolve()
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    backend.resolve({ updatedTaskCount: 2 })
    await pending
})

it('allows independent projects to persist concurrently', async () => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValue(backend.promise)
    const first = postponeProjectTasks('p1', tomorrow)
    const second = postponeProjectTasks('p2', tomorrow)
    expect(second).not.toBe(first)
    await Promise.resolve()
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    backend.resolve({ updatedTaskCount: 2 })
    await Promise.all([first, second])
})

it('never overwrites a newer live task edit on rollback', async () => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(backend.promise)
    const pending = postponeProjectTasks('p1', tomorrow)
    const changed = { ...task, dueDate: tomorrow + 86400000, name: 'Edited while postponing' }
    publishTasks([changed])
    const rejection = expect(pending).rejects.toThrow('offline')
    backend.reject(new Error('offline'))
    await rejection
    expect(mockState.openTasksMap.p1.t1).toEqual(changed)
    expect(projectTaskPreview(changed, getProjectPostpone('p1', 'u1'))).toEqual({ task: changed, hidden: false })
})

it('retires confirmed overlays before the callable returns, so undo cannot rehide restored tasks', async () => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(backend.promise)
    const pending = postponeProjectTasks('p1', tomorrow)
    publishTasks(tasks.map(task => (task.id === 't1' ? { ...task, dueDate: tomorrow, sortIndex: 10 } : task)))
    expect(projectTaskPreview(task, getProjectPostpone('p1', 'u1')).hidden).toBe(false)
    publishTasks(tasks)
    expect(projectTaskPreview(task, getProjectPostpone('p1', 'u1')).hidden).toBe(false)
    backend.resolve({ updatedTaskCount: 2 })
    await pending
})

it('clears an unconfirmed overlay on successful undo, including undo before the postpone response', async () => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(backend.promise)
    const pending = postponeProjectTasks('p1', tomorrow)
    const actionId = getProjectPostpone('p1', 'u1').requestId
    await reverseUndoAction(actionId, 'undo')
    expect(getProjectPostpone('p1', 'u1')).toBeUndefined()
    backend.resolve({ updatedTaskCount: 2 })
    await pending
    expect(getProjectPostpone('p1', 'u1')).toBeUndefined()
})

it('does not clear the preview when undo fails', async () => {
    await postponeProjectTasks('p1', tomorrow)
    const actionId = getProjectPostpone('p1', 'u1').requestId
    mockReverse.mockRejectedValueOnce(new Error('offline'))
    await expect(reverseUndoAction(actionId, 'undo')).rejects.toThrow('offline')
    expect(projectTaskPreview(task, getProjectPostpone('p1', 'u1')).hidden).toBe(true)
})

it('keeps pending feedback through a cold request, and bounds the listener echo only after success', async () => {
    const backend = deferred()
    runHttpsCallableFunction.mockReturnValueOnce(backend.promise)
    const pending = postponeProjectTasks('p1', tomorrow)
    jest.advanceTimersByTime(PROJECT_POSTPONE_ECHO_TIMEOUT_MS * 2)
    expect(getProjectPostpone('p1', 'u1').saving).toBe(true)
    backend.resolve({ updatedTaskCount: 2 })
    await pending
    jest.advanceTimersByTime(PROJECT_POSTPONE_ECHO_TIMEOUT_MS)
    expect(getProjectPostpone('p1', 'u1')).toBeUndefined()
})

it('guards old cleanup from erasing a newer action', async () => {
    await postponeProjectTasks('p1', tomorrow)
    const oldId = getProjectPostpone('p1', 'u1').requestId
    await postponeProjectTasks('p1', tomorrow)
    const newId = getProjectPostpone('p1', 'u1').requestId
    clearProjectPostpone('p1', 'u1', oldId)
    expect(getProjectPostpone('p1', 'u1').requestId).toBe(newId)
})

it('shows a same-day target date immediately instead of hiding the task', async () => {
    await postponeProjectTasks('p1', now + 1000)
    expect(projectTaskPreview(task, getProjectPostpone('p1', 'u1'))).toEqual({
        task: { ...task, dueDate: now + 1000 },
        hidden: false,
    })
})

it('keeps parents mounted when they contain future or other users’ subtasks', async () => {
    mockState.subtaskByTaskStore.p1u1 = { t1: [foreign, future] }
    let tree
    act(() => {
        tree = mountRows()
    })
    await act(async () => {
        await postponeProjectTasks('p1', tomorrow)
    })
    expect(rowIds(tree)).toContain('t1')
    act(() => {
        tree.unmount()
    })
})

it('skips optimistic removal when the loaded selection already exceeds the bulk limit', async () => {
    publishTasks(Array.from({ length: 451 }, (_, i) => ({ ...task, id: `t${i}` })))
    await postponeProjectTasks('p1', tomorrow)
    expect(getProjectPostpone('p1', 'u1').previews).toEqual({})
})

it('cleans up immediately when the server finds no eligible tasks', async () => {
    runHttpsCallableFunction.mockResolvedValueOnce({ updatedTaskCount: 0 })
    await postponeProjectTasks('p1', tomorrow)
    expect(getProjectPostpone('p1', 'u1')).toBeUndefined()
})
