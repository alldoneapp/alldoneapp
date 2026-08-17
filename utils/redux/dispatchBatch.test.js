import { batchDispatch, isCollectingDispatchBatch, runInDispatchBatch } from './dispatchBatch'
import store from '../../redux/store'

jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { dispatch: jest.fn(action => action) },
}))

describe('dispatchBatch (AT-2337)', () => {
    beforeEach(() => {
        store.dispatch.mockClear()
    })

    it('dispatches straight through when no batch is open', () => {
        batchDispatch({ type: 'A' })
        batchDispatch({ type: 'B' })

        expect(store.dispatch).toHaveBeenCalledTimes(2)
        expect(store.dispatch).toHaveBeenNthCalledWith(1, { type: 'A' })
        expect(store.dispatch).toHaveBeenNthCalledWith(2, { type: 'B' })
    })

    it('coalesces a batch into ONE array dispatch, preserving order', () => {
        runInDispatchBatch(() => {
            batchDispatch({ type: 'A' })
            batchDispatch({ type: 'B' })
            batchDispatch({ type: 'C' })
        })

        // The whole point: one notification instead of three.
        expect(store.dispatch).toHaveBeenCalledTimes(1)
        expect(store.dispatch).toHaveBeenCalledWith([{ type: 'A' }, { type: 'B' }, { type: 'C' }])
    })

    it('dispatches a lone action unwrapped rather than as a 1-element array', () => {
        runInDispatchBatch(() => batchDispatch({ type: 'A' }))

        expect(store.dispatch).toHaveBeenCalledTimes(1)
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'A' })
    })

    it('dispatches nothing when the batch collected nothing', () => {
        runInDispatchBatch(() => {})

        expect(store.dispatch).not.toHaveBeenCalled()
    })

    it('returns the callback result', () => {
        expect(runInDispatchBatch(() => 'result')).toBe('result')
    })

    it('joins an outer batch instead of flushing early when nested', () => {
        runInDispatchBatch(() => {
            batchDispatch({ type: 'outer-before' })
            runInDispatchBatch(() => {
                batchDispatch({ type: 'inner' })
            })
            // If the inner call had flushed, this would land in a second dispatch.
            batchDispatch({ type: 'outer-after' })
        })

        expect(store.dispatch).toHaveBeenCalledTimes(1)
        expect(store.dispatch).toHaveBeenCalledWith([
            { type: 'outer-before' },
            { type: 'inner' },
            { type: 'outer-after' },
        ])
    })

    it('flushes what it collected even when the callback throws', () => {
        expect(() =>
            runInDispatchBatch(() => {
                batchDispatch({ type: 'A' })
                throw new Error('boom')
            })
        ).toThrow('boom')

        // A snapshot handler that fails must not strand queued actions, and must
        // not leave the module stuck in "collecting" for every later dispatch.
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'A' })
        expect(isCollectingDispatchBatch()).toBe(false)

        store.dispatch.mockClear()
        batchDispatch({ type: 'B' })
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'B' })
    })

    it('reports whether a batch is open', () => {
        expect(isCollectingDispatchBatch()).toBe(false)
        runInDispatchBatch(() => {
            expect(isCollectingDispatchBatch()).toBe(true)
        })
        expect(isCollectingDispatchBatch()).toBe(false)
    })
})
