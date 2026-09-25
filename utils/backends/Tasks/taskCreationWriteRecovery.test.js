/** Drive the actual task creation path through a delayed Firestore acknowledgement. */

jest.mock('../firestore', () => {
    const generated = {}
    const overrides = {
        getDb: () => global.__TASK_WRITE_DB__,
        generateSortIndex: () => 1000,
        getMentionedUsersIdsWhenEditText: () => [],
        mapTaskData: (id, data) => ({ id, ...data }),
    }
    return new Proxy(
        {},
        {
            get: (_, key) => {
                if (key === '__esModule') return true
                if (key in overrides) return overrides[key]
                if (typeof key !== 'string') return undefined
                if (!generated[key]) generated[key] = jest.fn(() => ({}))
                return generated[key]
            },
        }
    )
})
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ loggedUser: { uid: 'user-1', templateProjectIds: [] } }),
        dispatch: jest.fn(),
    },
}))
jest.mock('./optimisticTaskCreate', () => ({
    publishOptimisticTaskCreated: jest.fn(),
    publishOptimisticTaskCreateFailed: jest.fn(),
}))
jest.mock('./optimisticTaskSettlement', () => ({ settleOptimisticTaskRow: jest.fn() }))
jest.mock('../../undo/undoActions', () => ({
    buildTaskCreateOperation: jest.fn(() => ({})),
    queueUndoAction: jest.fn(),
}))

import { uploadNewTask } from './tasksFirestore'
import { installTaskWriteMonitor, TASK_WRITE_MARKER_PREFIX } from '../taskWriteMonitor'
import { installConnectionHealthMonitor, resetConnectionHealthForTests } from '../../connectionHealth'
import { resetFirestoreRestartLeaseForTests } from '../firestoreRestartLease'
import { publishOptimisticTaskCreated, publishOptimisticTaskCreateFailed } from './optimisticTaskCreate'
import { settleOptimisticTaskRow } from './optimisticTaskSettlement'
import { queueUndoAction } from '../../undo/undoActions'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

describe('task creation write acknowledgement', () => {
    let resolveWrite, rejectWrite, set, db, stopMonitor, stopHealth
    const pendingKey = `${TASK_WRITE_MARKER_PREFIX}user-1:task-1`
    const createTask = awaited =>
        uploadNewTask(
            'project-1',
            {
                ...TasksHelper.getNewDefaultTask(true),
                id: 'task-1',
                name: 'New task',
                userId: 'user-1',
            },
            '',
            awaited,
            true,
            true
        )

    beforeEach(() => {
        jest.useFakeTimers()
        localStorage.clear()
        jest.clearAllMocks()
        resetConnectionHealthForTests()
        resetFirestoreRestartLeaseForTests()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(TasksHelper, 'getContactInProject').mockReturnValue(null)
        jest.spyOn(TasksHelper, 'getDueDateAndEstimationsByObserversIds').mockReturnValue({
            dueDateByObserversIds: {},
            estimationsByObserverIds: {},
        })
        jest.spyOn(ProjectHelper, 'getProjectById').mockReturnValue({ id: 'project-1', userIds: ['user-1'] })
        const pendingWrite = new Promise((resolve, reject) => {
            resolveWrite = resolve
            rejectWrite = reject
        })
        set = jest.fn(() => pendingWrite)
        db = {
            doc: jest.fn(() => ({ set })),
            disableNetwork: jest.fn(() => Promise.resolve()),
            enableNetwork: jest.fn(() => Promise.resolve()),
        }
        global.__TASK_WRITE_DB__ = db
        stopHealth = installConnectionHealthMonitor({
            getDb: () => db,
            dispatchHealth: jest.fn(),
            trackEvent: jest.fn(),
            intervalMs: 1000000,
        })
        stopMonitor = installTaskWriteMonitor(db, {
            currentUser: { uid: 'user-1' },
            onAuthStateChanged: () => () => {},
        })
    })
    afterEach(() => {
        stopMonitor()
        stopHealth()
        resetConnectionHealthForTests()
        resetFirestoreRestartLeaseForTests()
        jest.restoreAllMocks()
        jest.useRealTimers()
        delete global.__TASK_WRITE_DB__
    })

    it.each([false, true])('keeps optimistic rendering and ack side effects intact (awaited=%s)', async awaited => {
        let completed = false
        const creation = createTask(awaited).then(task => {
            completed = true
            return task
        })
        await jest.advanceTimersByTimeAsync(0)
        expect(completed).toBe(!awaited)
        expect(publishOptimisticTaskCreated).toHaveBeenCalledWith(
            'project-1',
            'task-1',
            expect.objectContaining({ name: 'New task' })
        )
        expect(localStorage.getItem(pendingKey)).not.toBeNull()
        await jest.advanceTimersByTimeAsync(9999)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(set).toHaveBeenCalledTimes(1)
        expect(settleOptimisticTaskRow).not.toHaveBeenCalled()
        expect(queueUndoAction).not.toHaveBeenCalled()
        resolveWrite()
        await expect(creation).resolves.toEqual(expect.objectContaining({ id: 'task-1' }))
        await jest.advanceTimersByTimeAsync(0)
        expect(localStorage.getItem(pendingKey)).toBeNull()
        expect(settleOptimisticTaskRow).toHaveBeenCalledTimes(1)
        expect(queueUndoAction).toHaveBeenCalledTimes(1)
        expect(publishOptimisticTaskCreateFailed).not.toHaveBeenCalled()
        expect(set).toHaveBeenCalledTimes(1)
    })

    it.each([false, true])('preserves rollback when the original write rejects (awaited=%s)', async awaited => {
        const creation = createTask(awaited)
        const denied = new Error('permission denied')
        const rejectedCreation = awaited ? expect(creation).rejects.toBe(denied) : creation
        rejectWrite(denied)
        await rejectedCreation
        await jest.advanceTimersByTimeAsync(0)
        expect(publishOptimisticTaskCreateFailed).toHaveBeenCalledTimes(1)
        expect(settleOptimisticTaskRow).not.toHaveBeenCalled()
        expect(queueUndoAction).not.toHaveBeenCalled()
        expect(localStorage.getItem(pendingKey)).toBeNull()
        await jest.advanceTimersByTimeAsync(60000)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(set).toHaveBeenCalledTimes(1)
    })
})
