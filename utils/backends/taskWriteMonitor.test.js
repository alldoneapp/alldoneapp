/** @jest-environment jsdom */

import {
    createTaskWriteMonitor,
    installTaskWriteMonitor,
    trackTaskWrite,
    TASK_WRITE_MARKER_PREFIX,
    TASK_WRITE_DIAGNOSTICS_KEY,
} from './taskWriteMonitor'
import {
    continueOffline,
    evaluateConnectionHealth,
    getConnectionHealth,
    installConnectionHealthMonitor,
    resetConnectionHealthForTests,
} from '../connectionHealth'
import { installAppResumeListener } from '../appResume'
import { resetFirestoreRestartLeaseForTests } from './firestoreRestartLease'
import { logPerformanceMeasurement } from '../performance/performanceLogger'

jest.mock('../performance/performanceLogger', () => ({ logPerformanceMeasurement: jest.fn() }))

const deferred = () => {
    let resolve, reject
    const promise = new Promise((yes, no) => {
        resolve = yes
        reject = no
    })
    return { promise, resolve, reject }
}
const marker = (taskId = 'task-1', userId = 'user-1') => `${TASK_WRITE_MARKER_PREFIX}${userId}:${taskId}`
const eventTarget = extra => Object.assign(new EventTarget(), extra)
const emit = (target, type) => target.dispatchEvent(new Event(type))

describe('pending task write recovery', () => {
    const cleanups = []
    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(1000000)
        localStorage.clear()
        jest.clearAllMocks()
        resetConnectionHealthForTests()
        resetFirestoreRestartLeaseForTests()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        cleanups
            .splice(0)
            .reverse()
            .forEach(stop => stop())
        resetConnectionHealthForTests()
        resetFirestoreRestartLeaseForTests()
        jest.useRealTimers()
        console.warn.mockRestore()
    })

    const setup = () => {
        const environment = { offline: false }
        const windowObject = eventTarget()
        const documentObject = eventTarget({ visibilityState: 'visible' })
        const queue = deferred()
        const get = jest.fn(() => Promise.resolve({ exists: true }))
        const db = {
            doc: jest.fn(() => ({ get })),
            disableNetwork: jest.fn(() => Promise.resolve()),
            enableNetwork: jest.fn(() => Promise.resolve()),
            waitForPendingWrites: jest.fn(() => queue.promise),
        }
        cleanups.push(
            installConnectionHealthMonitor({
                windowObject,
                documentObject,
                getDb: () => db,
                isOffline: () => environment.offline,
                dispatchHealth: jest.fn(),
                trackEvent: jest.fn(),
                intervalMs: 1000000,
            })
        )
        const evaluateResume = jest.fn()
        cleanups.push(
            installAppResumeListener({
                windowObject,
                documentObject,
                evaluateConnection: evaluateResume,
                runIntegrityCheck: jest.fn(),
                updateServiceWorker: jest.fn(),
            })
        )
        const record = jest.fn()
        const createMonitor = (options = {}) => {
            const monitor = createTaskWriteMonitor({
                db,
                isOffline: () => environment.offline,
                isHidden: () => documentObject.visibilityState === 'hidden',
                record,
                ...options,
            })
            cleanups.push(() => monitor.stop())
            monitor.setUser('user-1')
            return monitor
        }
        const monitor = createMonitor()
        const write = deferred()
        const track = (taskId = 'task-1', pendingWrite = write) =>
            monitor.track(pendingWrite.promise, { userId: 'user-1', taskId })
        return {
            environment,
            windowObject,
            documentObject,
            db,
            get,
            queue,
            record,
            monitor,
            createMonitor,
            write,
            track,
            evaluateResume,
        }
    }

    it.each([800, 9900])('leaves a write acknowledged in %i ms uninterrupted', async durationMs => {
        const { track, write, record, db } = setup()
        expect(track()).toBe(write.promise)
        expect(localStorage.getItem(marker())).not.toBeNull()
        await jest.advanceTimersByTimeAsync(durationMs)
        write.resolve('ack')
        await expect(write.promise).resolves.toBe('ack')
        await jest.advanceTimersByTimeAsync(0)
        expect(localStorage.getItem(marker())).toBeNull()
        expect(record).toHaveBeenCalledWith('server_acked', durationMs, 0, 'task_create')
        await jest.advanceTimersByTimeAsync(120000)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(db.waitForPendingWrites).not.toHaveBeenCalled()
    })

    it('detects a stalled write even while server reads succeed, without treating recovery as an ack', async () => {
        const { track, write, record, db, get } = setup()
        track()
        await jest.advanceTimersByTimeAsync(9999)
        await evaluateConnectionHealth({ trigger: 'working_read' })
        expect(get).toHaveBeenCalled()
        expect(db.disableNetwork).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(db.enableNetwork).toHaveBeenCalledTimes(1)
        expect(localStorage.getItem(marker())).not.toBeNull()
        expect(record.mock.calls.some(([phase]) => phase === 'server_acked')).toBe(false)
        // Early recovery is quiet; the existing warning still appears if the
        // original write remains unacknowledged at fifteen seconds.
        expect(getConnectionHealth()).toBe('live')
        await jest.advanceTimersByTimeAsync(5000)
        expect(getConnectionHealth()).toBe('slow')
        await evaluateConnectionHealth({ trigger: 'working_read' })
        expect(getConnectionHealth()).toBe('slow')
        write.resolve()
        await jest.advanceTimersByTimeAsync(0)
        expect(record).toHaveBeenCalledWith('server_acked', 15000, 0, 'task_create')
        await jest.advanceTimersByTimeAsync(120000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(getConnectionHealth()).toBe('live')
    })

    it('recovers on a short reopen and coalesces the visibility, pageshow and focus signals', async () => {
        const { track, db, documentObject, windowObject, evaluateResume } = setup()
        track()
        await jest.advanceTimersByTimeAsync(5000)
        documentObject.visibilityState = 'hidden'
        emit(documentObject, 'visibilitychange')
        await jest.advanceTimersByTimeAsync(6000)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        documentObject.visibilityState = 'visible'
        emit(documentObject, 'visibilitychange')
        emit(windowObject, 'pageshow')
        emit(windowObject, 'focus')
        await jest.advanceTimersByTimeAsync(0)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        expect(evaluateResume).not.toHaveBeenCalled()
    })

    it('does no network work for ordinary app switches without pending writes', async () => {
        const { db, windowObject } = setup()
        await jest.advanceTimersByTimeAsync(120000)
        emit(windowObject, 'focus')
        await jest.advanceTimersByTimeAsync(0)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(db.doc).not.toHaveBeenCalled()
    })

    it('respects offline mode and starts recovery when connectivity returns', async () => {
        const { track, db, environment, windowObject } = setup()
        environment.offline = true
        emit(windowObject, 'offline')
        track()
        await jest.advanceTimersByTimeAsync(120000)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(getConnectionHealth()).toBe('offline')
        environment.offline = false
        emit(windowObject, 'online')
        await jest.advanceTimersByTimeAsync(5000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
    })

    it('never undoes the explicit Continue offline choice', async () => {
        const { track, db, windowObject } = setup()
        track()
        await continueOffline()
        db.disableNetwork.mockClear()
        await jest.advanceTimersByTimeAsync(180000)
        emit(windowObject, 'focus')
        await jest.advanceTimersByTimeAsync(0)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(db.enableNetwork).not.toHaveBeenCalled()
        expect(localStorage.getItem(marker())).not.toBeNull()
    })

    it('bounds retries and waits for write progress before restarting again', async () => {
        const { track, db, write } = setup()
        track()
        track('task-2', deferred())
        await jest.advanceTimersByTimeAsync(10000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(55000)
        write.resolve()
        await jest.advanceTimersByTimeAsync(5000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(5000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(2)
    })

    it('keeps a rejection observable to the caller and removes its pending marker', async () => {
        const { track, write, db, record } = setup()
        const result = track()
        const error = new Error('permission denied')
        const assertion = expect(result).rejects.toBe(error)
        write.reject(error)
        await assertion
        expect(localStorage.getItem(marker())).toBeNull()
        expect(record).toHaveBeenCalledWith('rejected', 0, 0, 'task_create')
        await jest.advanceTimersByTimeAsync(60000)
        expect(db.disableNetwork).not.toHaveBeenCalled()
    })

    it('restores the original age after reload and watches the existing queue without recreating a task', async () => {
        const { track, monitor, createMonitor, db, queue, record } = setup()
        track()
        await jest.advanceTimersByTimeAsync(5000)
        monitor.stop()
        await jest.advanceTimersByTimeAsync(55000)
        createMonitor()
        expect(db.waitForPendingWrites).toHaveBeenCalledTimes(1)
        expect(record).toHaveBeenCalledWith('restored', 60000, 1, 'restored_queue')
        await jest.advanceTimersByTimeAsync(5000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        queue.resolve()
        await jest.advanceTimersByTimeAsync(0)
        expect(localStorage.getItem(marker())).toBeNull()
        expect(record).toHaveBeenCalledWith('queue_drained', 65000, 0, 'restored_queue')
        expect(record.mock.calls.some(([phase]) => phase === 'server_acked')).toBe(false)
        expect(db.doc).not.toHaveBeenCalled()
    })

    it('lets an already-drained restored queue settle before trying recovery', async () => {
        const { track, monitor, createMonitor, db, queue } = setup()
        track()
        monitor.stop()
        await jest.advanceTimersByTimeAsync(120000)
        queue.resolve()
        createMonitor()
        await jest.advanceTimersByTimeAsync(10000)
        expect(localStorage.getItem(marker())).toBeNull()
        expect(db.disableNetwork).not.toHaveBeenCalled()
    })

    it('preserves recovery cooldown across a full reload', async () => {
        const { track, monitor, createMonitor, db } = setup()
        track()
        await jest.advanceTimersByTimeAsync(10000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        monitor.stop()
        createMonitor()
        await jest.advanceTimersByTimeAsync(55000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(5000)
        expect(db.disableNetwork).toHaveBeenCalledTimes(2)
    })

    it('does not apply an old account checkpoint after switching users', async () => {
        const { track, monitor, createMonitor, db, queue } = setup()
        track()
        monitor.stop()
        const restored = createMonitor()
        restored.setUser('user-2')
        queue.resolve()
        await jest.advanceTimersByTimeAsync(60000)
        expect(localStorage.getItem(marker())).not.toBeNull()
        expect(db.disableNetwork).not.toHaveBeenCalled()
        expect(db.waitForPendingWrites).toHaveBeenCalledTimes(1)
        restored.setUser('user-1')
        await jest.advanceTimersByTimeAsync(0)
        expect(localStorage.getItem(marker())).toBeNull()
    })

    it('restores valid markers despite another malformed entry and a rejected queue checkpoint', async () => {
        const { track, monitor, createMonitor, db, queue } = setup()
        localStorage.setItem(marker('broken'), '{broken')
        track()
        monitor.stop()
        queue.reject(new Error('auth changed'))
        createMonitor()
        await jest.advanceTimersByTimeAsync(0)
        expect(localStorage.getItem(marker())).not.toBeNull()
        db.waitForPendingWrites.mockResolvedValue()
        await jest.advanceTimersByTimeAsync(5000)
        expect(localStorage.getItem(marker())).toBeNull()
    })

    it('keeps a bounded timing journal without identifiers or task contents', async () => {
        const { monitor, createMonitor } = setup()
        monitor.stop()
        const monitored = createMonitor({ record: undefined })
        for (let index = 0; index < 60; index++) {
            await monitored.track(Promise.resolve(), { userId: 'user-1', taskId: `secret-task-${index}` })
        }
        const journal = JSON.parse(localStorage.getItem(TASK_WRITE_DIAGNOSTICS_KEY))
        expect(journal).toHaveLength(50)
        expect(journal[0]).toEqual({
            at: Date.now(),
            phase: 'server_acked',
            durationMs: 0,
            pendingCount: 0,
            source: 'task_create',
        })
        expect(JSON.stringify(journal)).not.toContain('secret-task')
        expect(JSON.stringify(logPerformanceMeasurement.mock.calls)).not.toContain('user-1')
        expect(JSON.stringify(logPerformanceMeasurement.mock.calls)).not.toContain('secret-task')
    })

    it('installs the production tracker against auth and leaves the original write contract intact', async () => {
        const { db, monitor } = setup()
        monitor.stop()
        let authChanged
        const unsubscribe = jest.fn()
        const stop = installTaskWriteMonitor(db, {
            currentUser: { uid: 'user-1' },
            onAuthStateChanged: callback => {
                authChanged = callback
                return unsubscribe
            },
        })
        cleanups.push(stop)
        const write = deferred()
        expect(trackTaskWrite(write.promise, { userId: 'user-1', taskId: 'task-1' })).toBe(write.promise)
        expect(localStorage.getItem(marker())).not.toBeNull()
        authChanged(null)
        await jest.advanceTimersByTimeAsync(60000)
        expect(db.disableNetwork).not.toHaveBeenCalled()
        write.resolve()
        await jest.advanceTimersByTimeAsync(0)
        expect(localStorage.getItem(marker())).toBeNull()
        stop()
        expect(unsubscribe).toHaveBeenCalled()
    })
})
