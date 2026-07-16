import { DAILY_APP_LOAD_DATE_STORAGE_KEY, getLocalCalendarDate, startDailyAppReload } from '../../utils/DailyAppReload'

function createEventTarget(properties = {}) {
    const listeners = {}

    return {
        ...properties,
        addEventListener: jest.fn((event, callback) => {
            listeners[event] = callback
        }),
        removeEventListener: jest.fn((event, callback) => {
            if (listeners[event] === callback) delete listeners[event]
        }),
        dispatch(event) {
            if (listeners[event]) listeners[event]()
        },
    }
}

function createStorage(initialValues = {}) {
    const values = { ...initialValues }

    return {
        getItem: jest.fn(key => values[key] || null),
        setItem: jest.fn((key, value) => {
            values[key] = value
        }),
        value(key) {
            return values[key]
        },
    }
}

function createGuard(startTime, options = {}) {
    let currentTime = new Date(startTime)
    let scheduledCallback
    const documentObject = createEventTarget({ visibilityState: 'visible' })
    const windowObject = createEventTarget()
    const storage = options.storage || createStorage()
    const reload = jest.fn()
    const clearTimer = jest.fn()

    const stop = startDailyAppReload({
        windowObject,
        documentObject,
        storage,
        now: () => new Date(currentTime),
        reload,
        setTimer: jest.fn(callback => {
            scheduledCallback = callback
            return 42
        }),
        clearTimer,
    })

    return {
        clearTimer,
        documentObject,
        reload,
        runTimer: () => scheduledCallback(),
        setTime: time => {
            currentTime = new Date(time)
        },
        stop,
        storage,
        windowObject,
    }
}

describe('DailyAppReload', () => {
    it('formats dates using the device local calendar', () => {
        expect(getLocalCalendarDate(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02')
    })

    it('counts the initial app bootstrap as today full load without reloading again', () => {
        const guard = createGuard('2026-07-10T09:00:00')

        expect(guard.reload).not.toHaveBeenCalled()
        expect(guard.storage.value(DAILY_APP_LOAD_DATE_STORAGE_KEY)).toBe('2026-07-10')
    })

    it('reloads on startup when this device was last loaded on an earlier day without looping', () => {
        const storage = createStorage({ [DAILY_APP_LOAD_DATE_STORAGE_KEY]: '2026-07-10' })
        const firstLoad = createGuard('2026-07-11T09:00:00', { storage })

        expect(storage.value(DAILY_APP_LOAD_DATE_STORAGE_KEY)).toBe('2026-07-11')
        expect(firstLoad.reload).toHaveBeenCalledTimes(1)

        const replacementLoad = createGuard('2026-07-11T09:00:01', { storage })
        expect(replacementLoad.reload).not.toHaveBeenCalled()
    })

    it('defers a startup reload until a background-restored tab becomes active', () => {
        const storage = createStorage({ [DAILY_APP_LOAD_DATE_STORAGE_KEY]: '2026-07-10' })
        const documentObject = createEventTarget({ visibilityState: 'hidden' })
        const windowObject = createEventTarget()
        const reload = jest.fn()

        const stop = startDailyAppReload({
            windowObject,
            documentObject,
            storage,
            now: () => new Date('2026-07-11T09:00:00'),
            reload,
        })

        expect(reload).not.toHaveBeenCalled()
        expect(storage.value(DAILY_APP_LOAD_DATE_STORAGE_KEY)).toBe('2026-07-10')

        documentObject.visibilityState = 'visible'
        documentObject.dispatch('visibilitychange')
        expect(reload).toHaveBeenCalledTimes(1)
        stop()
    })

    it('reloads once after the local midnight timer and marks the day before navigating', () => {
        const guard = createGuard('2026-07-10T23:59:00')
        guard.setTime('2026-07-11T00:00:01')

        guard.runTimer()
        guard.windowObject.dispatch('focus')

        expect(guard.storage.value(DAILY_APP_LOAD_DATE_STORAGE_KEY)).toBe('2026-07-11')
        expect(guard.reload).toHaveBeenCalledTimes(1)
    })

    it('waits while hidden and reloads when the tab becomes visible later', () => {
        const guard = createGuard('2026-07-10T18:00:00')
        guard.documentObject.visibilityState = 'hidden'
        guard.setTime('2026-07-11T08:00:00')

        guard.runTimer()
        expect(guard.reload).not.toHaveBeenCalled()

        guard.documentObject.visibilityState = 'visible'
        guard.documentObject.dispatch('visibilitychange')
        expect(guard.reload).toHaveBeenCalledTimes(1)
    })

    it('checks the day when a suspended page receives focus or is restored', () => {
        const focusGuard = createGuard('2026-07-10T18:00:00')
        focusGuard.setTime('2026-07-11T08:00:00')
        focusGuard.windowObject.dispatch('focus')

        const restoredGuard = createGuard('2026-07-10T18:00:00')
        restoredGuard.setTime('2026-07-11T08:00:00')
        restoredGuard.windowObject.dispatch('pageshow')

        expect(focusGuard.reload).toHaveBeenCalledTimes(1)
        expect(restoredGuard.reload).toHaveBeenCalledTimes(1)
    })

    it('keeps the daily reload independent for separate device-local stores', () => {
        const firstDevice = createGuard('2026-07-10T18:00:00')
        const secondDevice = createGuard('2026-07-10T18:00:00')
        firstDevice.setTime('2026-07-11T08:00:00')
        secondDevice.setTime('2026-07-11T08:00:00')

        firstDevice.windowObject.dispatch('focus')

        expect(firstDevice.reload).toHaveBeenCalledTimes(1)
        expect(secondDevice.storage.value(DAILY_APP_LOAD_DATE_STORAGE_KEY)).toBe('2026-07-10')

        secondDevice.windowObject.dispatch('focus')
        expect(secondDevice.reload).toHaveBeenCalledTimes(1)
    })

    it('still reloads once when browser storage is unavailable', () => {
        const storage = {
            getItem: jest.fn(() => {
                throw new Error('Storage disabled')
            }),
            setItem: jest.fn(),
        }
        const guard = createGuard('2026-07-10T18:00:00', { storage })
        guard.setTime('2026-07-11T08:00:00')

        guard.windowObject.dispatch('focus')
        guard.windowObject.dispatch('focus')

        expect(guard.reload).toHaveBeenCalledTimes(1)
    })

    it('removes lifecycle listeners and the timer during cleanup', () => {
        const guard = createGuard('2026-07-10T18:00:00')

        guard.stop()

        expect(guard.clearTimer).toHaveBeenCalledWith(42)
        expect(guard.documentObject.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
        expect(guard.windowObject.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))
        expect(guard.windowObject.removeEventListener).toHaveBeenCalledWith('pageshow', expect.any(Function))
    })
})
