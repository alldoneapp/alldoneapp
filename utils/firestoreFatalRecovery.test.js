/** @jest-environment jsdom */

import {
    FIRESTORE_FATAL_RECOVERY_STORAGE_KEY,
    installFirestoreFatalRecovery,
    isFatalFirestoreInternalError,
    reportFatalFirestoreError,
    requestFirestoreClientReload,
    resetFirestoreFatalRecoveryForTests,
} from './firestoreFatalRecovery'

const FATAL_ERROR = new Error(
    'FIRESTORE (12.17.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) ' +
        'CONTEXT: {"rl":"FIRESTORE INTERNAL ASSERTION FAILED (ID: ca9) CONTEXT: {\\"M\\":-1}"}'
)

const createStorage = () => {
    const values = new Map()
    return {
        getItem: jest.fn(key => values.get(key) || null),
        setItem: jest.fn((key, value) => values.set(key, value)),
    }
}

const createWindow = ({ online = true } = {}) => {
    const listeners = {}
    return {
        navigator: { onLine: online },
        location: { reload: jest.fn() },
        addEventListener: (type, listener) => {
            listeners[type] = listeners[type] || []
            listeners[type].push(listener)
        },
        removeEventListener: (type, listener) => {
            listeners[type] = (listeners[type] || []).filter(candidate => candidate !== listener)
        },
        emit: (type, event = {}) => (listeners[type] || []).forEach(listener => listener(event)),
        listenerCount: type => (listeners[type] || []).length,
    }
}

describe('firestoreFatalRecovery', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
        resetFirestoreFatalRecoveryForTests()
    })

    afterEach(() => {
        resetFirestoreFatalRecoveryForTests()
        jest.useRealTimers()
        console.warn.mockRestore()
        console.error.mockRestore()
    })

    it('matches only the fatal Firestore assertion family', () => {
        expect(isFatalFirestoreInternalError(FATAL_ERROR)).toBe(true)
        expect(
            isFatalFirestoreInternalError(
                new Error('FIRESTORE (12.17.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)')
            )
        ).toBe(true)
        expect(isFatalFirestoreInternalError(new Error('FirebaseError: permission-denied'))).toBe(false)
        expect(isFatalFirestoreInternalError(new Error('INTERNAL ASSERTION FAILED (ID: b815)'))).toBe(false)
    })

    it('reloads once when the fatal async queue rejection is observed', () => {
        const windowObject = createWindow()
        const storage = createStorage()
        const reload = jest.fn()
        const stop = installFirestoreFatalRecovery({
            windowObject,
            storage,
            reload,
            now: () => 100000,
            reloadDelayMs: 10,
        })

        windowObject.emit('unhandledrejection', { reason: FATAL_ERROR })
        windowObject.emit('error', { error: FATAL_ERROR })
        jest.advanceTimersByTime(10)

        expect(reload).toHaveBeenCalledTimes(1)
        expect(storage.setItem).toHaveBeenCalledWith(FIRESTORE_FATAL_RECOVERY_STORAGE_KEY, '100000')
        stop()
    })

    it('defers recovery while offline and reloads when connectivity returns', () => {
        const windowObject = createWindow({ online: false })
        const reload = jest.fn()
        const stop = installFirestoreFatalRecovery({ windowObject, storage: createStorage(), reload, reloadDelayMs: 0 })

        windowObject.emit('unhandledrejection', { reason: FATAL_ERROR })
        jest.runOnlyPendingTimers()
        expect(reload).not.toHaveBeenCalled()

        windowObject.navigator.onLine = true
        windowObject.emit('online')
        jest.runOnlyPendingTimers()
        expect(reload).toHaveBeenCalledTimes(1)
        stop()
    })

    it('suppresses a second automatic reload during the cooldown', () => {
        const windowObject = createWindow()
        const storage = createStorage()
        storage.setItem(FIRESTORE_FATAL_RECOVERY_STORAGE_KEY, '90000')
        const reload = jest.fn()
        const stop = installFirestoreFatalRecovery({
            windowObject,
            storage,
            reload,
            now: () => 100000,
            cooldownMs: 60000,
            reloadDelayMs: 0,
        })

        windowObject.emit('unhandledrejection', { reason: FATAL_ERROR })
        jest.runOnlyPendingTimers()

        expect(reload).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith(
            '[FirestoreRecovery] Fatal assertion repeated during reload cooldown; reload suppressed.'
        )
        stop()
    })

    it('accepts a fatal error forwarded by the React error boundary', () => {
        const reload = jest.fn()
        const stop = installFirestoreFatalRecovery({
            windowObject: createWindow(),
            storage: createStorage(),
            reload,
            reloadDelayMs: 0,
        })

        expect(reportFatalFirestoreError(FATAL_ERROR)).toBe(true)
        expect(reportFatalFirestoreError(new Error('ordinary render failure'))).toBe(false)
        jest.runOnlyPendingTimers()
        expect(reload).toHaveBeenCalledTimes(1)
        stop()
    })

    it('uses the same guarded reload for a Firestore client whose restart is stuck', () => {
        const windowObject = createWindow()
        const storage = createStorage()
        const reload = jest.fn()
        const stop = installFirestoreFatalRecovery({
            windowObject,
            storage,
            reload,
            now: () => 100000,
            reloadDelayMs: 10,
        })

        expect(requestFirestoreClientReload('restart_timeout')).toBe(true)
        jest.advanceTimersByTime(10)

        expect(reload).toHaveBeenCalledTimes(1)
        expect(storage.setItem).toHaveBeenCalledWith(FIRESTORE_FATAL_RECOVERY_STORAGE_KEY, '100000')
        stop()
    })

    it('waits for real connectivity before replacing a stuck Firestore client', () => {
        const windowObject = createWindow({ online: false })
        const reload = jest.fn()
        const stop = installFirestoreFatalRecovery({ windowObject, storage: createStorage(), reload, reloadDelayMs: 0 })

        expect(requestFirestoreClientReload('restart_timeout')).toBe(true)
        jest.runOnlyPendingTimers()
        expect(reload).not.toHaveBeenCalled()

        windowObject.navigator.onLine = true
        windowObject.emit('online')
        jest.runOnlyPendingTimers()
        expect(reload).toHaveBeenCalledTimes(1)
        stop()
    })

    it('removes all browser listeners on uninstall', () => {
        const windowObject = createWindow()
        const stop = installFirestoreFatalRecovery({ windowObject, storage: createStorage() })
        expect(windowObject.listenerCount('unhandledrejection')).toBe(1)
        expect(windowObject.listenerCount('error')).toBe(1)

        stop()
        expect(windowObject.listenerCount('unhandledrejection')).toBe(0)
        expect(windowObject.listenerCount('error')).toBe(0)
        expect(windowObject.listenerCount('online')).toBe(0)
    })
})
