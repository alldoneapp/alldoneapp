import { createStore } from 'redux'
import { reduceLoadingData } from '../../redux/loadingData'
import {
    beginLoadingOperation,
    subscribeWithLoading,
    runWithLoading,
    INITIAL_LOAD_TIMEOUT_MS,
    ACTION_LOADING_TIMEOUT_MS,
} from './loadingOperation'

jest.mock('./dispatchBatch', () => ({ batchDispatch: jest.fn() }))

describe('loading operation ownership', () => {
    let store
    let warn

    beforeEach(() => {
        jest.useFakeTimers()
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        store = createStore((state = { isLoadingData: 0 }, action) => reduceLoadingData(state, action))
    })

    afterEach(() => {
        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    const begin = (source, options) => beginLoadingOperation(source, { dispatch: store.dispatch, ...options })

    it('releases exactly one owner even with repeated completion and overlapping requests', () => {
        const finishFirst = begin('first')
        const finishSecond = begin('second')
        expect(store.getState().isLoadingData).toBe(2)
        finishFirst()
        finishFirst()
        expect(store.getState().isLoadingData).toBe(1)
        expect(Object.values(store.getState().loadingDataOperations).map(operation => operation.source)).toEqual([
            'second',
        ])
        finishSecond()
        expect(store.getState().showLoadingDataSpinner).toBe(false)
        expect(jest.getTimerCount()).toBe(0)
    })

    it('keeps owned work separate from old counter-based stops and resets', () => {
        const finish = begin('task_list')
        store.dispatch({ type: 'Start loading data', processes: 2 })
        expect(store.getState().isLoadingData).toBe(3)
        store.dispatch({ type: 'Stop loading data' })
        expect(store.getState().isLoadingData).toBe(2)
        store.dispatch({ type: 'Reset loading data' })
        store.dispatch({ type: 'Stop loading data' })
        expect(store.getState().isLoadingData).toBe(1)
        finish()
        expect(store.getState().isLoadingData).toBe(0)
    })

    it('does not decrement unrelated legacy work when an owned operation completes twice', () => {
        const finish = begin('first')
        store.dispatch({ type: 'Start loading data' })
        finish()
        finish()
        expect(store.getState().isLoadingData).toBe(1)
        store.dispatch({ type: 'Stop loading data' })
        expect(store.getState().showLoadingDataSpinner).toBe(false)
    })

    it.each(['cancelled', 'already_received_snapshot'])('never starts a deferred operation that is %s', () => {
        const finish = begin('tasks', { deferStart: true })
        finish()
        jest.runAllTimers()
        expect(store.getState().isLoadingData).toBe(0)
        expect(warn).not.toHaveBeenCalled()
    })

    it('expires only the stalled owner and ignores its late completion', () => {
        const finishStalled = begin('stalled')
        jest.advanceTimersByTime(INITIAL_LOAD_TIMEOUT_MS - 1000)
        const finishNew = begin('new')
        jest.advanceTimersByTime(1000)
        expect(store.getState().isLoadingData).toBe(1)
        expect(warn).toHaveBeenCalledWith('[LoadingData] Loading feedback timed out', {
            source: 'stalled',
            timeoutMs: INITIAL_LOAD_TIMEOUT_MS,
        })
        finishStalled()
        expect(store.getState().isLoadingData).toBe(1)
        finishNew()
        expect(store.getState().isLoadingData).toBe(0)
    })

    it('does not arm a timeout after a synchronous subscriber completes the operation', () => {
        // A custom dispatcher can synchronously remove the work from the screen.
        // The deferred start makes the cleanup handle available before dispatch.
        const finish = beginLoadingOperation('tasks', { deferStart: true, dispatch: () => finish() })
        jest.runAllTimers()
        expect(warn).not.toHaveBeenCalled()
    })

    it('keeps overlapping writes independent when one rejects', async () => {
        let rejectFirst
        let resolveSecond
        const first = runWithLoading(
            'first_write',
            () =>
                new Promise((resolve, reject) => {
                    rejectFirst = reject
                }),
            { dispatch: store.dispatch }
        )
        const second = runWithLoading(
            'second_write',
            () =>
                new Promise(resolve => {
                    resolveSecond = resolve
                }),
            { dispatch: store.dispatch }
        )
        expect(store.getState().isLoadingData).toBe(2)
        const failed = expect(first).rejects.toThrow('write failed')
        rejectFirst(new Error('write failed'))
        await failed
        expect(Object.values(store.getState().loadingDataOperations).map(operation => operation.source)).toEqual([
            'second_write',
        ])
        resolveSecond('saved')
        await expect(second).resolves.toBe('saved')
        expect(store.getState().isLoadingData).toBe(0)
        expect(jest.getTimerCount()).toBe(0)
    })

    it('releases a synchronous failure without changing the error', async () => {
        const error = new Error('setup failed')
        await expect(
            runWithLoading(
                'write',
                () => {
                    throw error
                },
                { dispatch: store.dispatch }
            )
        ).rejects.toBe(error)
        expect(store.getState().isLoadingData).toBe(0)
        expect(jest.getTimerCount()).toBe(0)
    })

    it('bounds write feedback without completing the write or clearing newer work on late failure', async () => {
        let rejectWrite
        const write = runWithLoading(
            'stalled_write',
            () =>
                new Promise((resolve, reject) => {
                    rejectWrite = reject
                }),
            { dispatch: store.dispatch }
        )
        const settled = jest.fn()
        const completion = write.catch(error => {
            settled(error)
        })
        jest.advanceTimersByTime(INITIAL_LOAD_TIMEOUT_MS)
        expect(store.getState().isLoadingData).toBe(1)
        jest.advanceTimersByTime(ACTION_LOADING_TIMEOUT_MS - INITIAL_LOAD_TIMEOUT_MS)
        await Promise.resolve()
        expect(store.getState().isLoadingData).toBe(0)
        expect(settled).not.toHaveBeenCalled()
        const finishNew = begin('new_load')
        rejectWrite(new Error('late failure'))
        await completion
        expect(settled).toHaveBeenCalledWith(expect.objectContaining({ message: 'late failure' }))
        expect(store.getState().isLoadingData).toBe(1)
        finishNew()
    })

    it('runs background work without foreground feedback or timers', async () => {
        const dispatch = jest.fn()
        await expect(runWithLoading('background', () => 'done', { dispatch, enabled: false })).resolves.toBe('done')
        expect(dispatch).not.toHaveBeenCalled()
        expect(jest.getTimerCount()).toBe(0)
    })
})

describe('plain snapshot loading lifecycle', () => {
    let next
    let error
    let nativeUnsubscribe
    let onSnapshot

    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(console, 'error').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        nativeUnsubscribe = jest.fn()
        onSnapshot = jest.fn()
    })

    afterEach(() => {
        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    const subscribe = options =>
        subscribeWithLoading(
            'assistants',
            (onNext, onError) => {
                next = onNext
                error = onError
                return nativeUnsubscribe
            },
            onSnapshot,
            options
        )

    it('stops on errors, calls the consumer error handler, and still unsubscribes once', () => {
        const onError = jest.fn()
        const unsubscribe = subscribe({ onError })
        const failure = { code: 'permission-denied' }
        error(failure)
        expect(onError).toHaveBeenCalledWith(failure)
        expect(jest.getTimerCount()).toBe(0)
        next([])
        expect(onSnapshot).not.toHaveBeenCalled()
        unsubscribe()
        unsubscribe()
        expect(nativeUnsubscribe).toHaveBeenCalledTimes(1)
    })

    it('retains live updates after the initial load deadline', () => {
        const unsubscribe = subscribe()
        jest.advanceTimersByTime(INITIAL_LOAD_TIMEOUT_MS)
        expect(nativeUnsubscribe).not.toHaveBeenCalled()
        next(['late data'])
        expect(onSnapshot).toHaveBeenCalledWith(['late data'])
        unsubscribe()
    })

    it('cleans up if listener setup throws', () => {
        const failure = new Error('setup failed')
        expect(() =>
            subscribeWithLoading(
                'assistants',
                () => {
                    throw failure
                },
                onSnapshot
            )
        ).toThrow(failure)
        expect(jest.getTimerCount()).toBe(0)
    })

    it('cleans up if a snapshot consumer throws', () => {
        const unsubscribe = subscribe()
        onSnapshot.mockImplementation(() => {
            throw new Error('invalid data')
        })
        expect(() => next([])).toThrow('invalid data')
        expect(jest.getTimerCount()).toBe(0)
        unsubscribe()
    })
})
