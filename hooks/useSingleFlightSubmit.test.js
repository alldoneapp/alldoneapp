import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useSingleFlightSubmit, { createSingleFlightSubmit, RELEASE_AFTER_SUBMISSION } from './useSingleFlightSubmit'

const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve
        reject = innerReject
    })
    return { promise, resolve, reject }
}

describe('createSingleFlightSubmit', () => {
    test('runs only the first of several calls made while a submission is in flight', () => {
        const pending = deferred()
        const submit = jest.fn(() => pending.promise)
        const guarded = createSingleFlightSubmit(submit)

        // A double Return, or one Return reaching several listeners at once.
        guarded('first')
        guarded('second')
        guarded('third')

        expect(submit).toHaveBeenCalledTimes(1)
        expect(submit).toHaveBeenCalledWith('first')
    })

    test('gives blocked callers the pending result instead of starting a new write', () => {
        const pending = deferred()
        const guarded = createSingleFlightSubmit(() => pending.promise)

        expect(guarded()).toBe(pending.promise)
        expect(guarded()).toBe(pending.promise)
    })

    test('stays locked after a successful submission so a closing popup cannot submit twice', async () => {
        const pending = deferred()
        const submit = jest.fn(() => pending.promise)
        const guarded = createSingleFlightSubmit(submit)

        guarded()
        pending.resolve({ id: 'task-1' })
        await pending.promise

        guarded()

        expect(submit).toHaveBeenCalledTimes(1)
        expect(guarded.isInFlight()).toBe(true)
    })

    test('allows consecutive distinct submissions when the editor stays open', async () => {
        const first = deferred()
        const second = deferred()
        const submit = jest.fn()
        submit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
        const guarded = createSingleFlightSubmit(submit, RELEASE_AFTER_SUBMISSION)

        guarded('task one')
        guarded('task one repeated by a second Return')
        expect(submit).toHaveBeenCalledTimes(1)

        first.resolve({ id: 'task-1' })
        await first.promise

        guarded('task two')

        expect(submit).toHaveBeenCalledTimes(2)
        expect(submit).toHaveBeenLastCalledWith('task two')
    })

    test('unlocks after a failed submission so the user can retry', async () => {
        const failing = deferred()
        const submit = jest.fn(() => failing.promise)
        const guarded = createSingleFlightSubmit(submit)

        const result = guarded()
        result.catch(() => {})
        failing.reject(new Error('offline'))
        await expect(result).rejects.toThrow('offline')

        guarded()

        expect(submit).toHaveBeenCalledTimes(2)
    })

    test('unlocks when the submission throws synchronously', () => {
        const submit = jest.fn(() => {
            throw new Error('bad task')
        })
        const guarded = createSingleFlightSubmit(submit)

        expect(() => guarded()).toThrow('bad task')
        expect(guarded.isInFlight()).toBe(false)

        expect(() => guarded()).toThrow('bad task')
        expect(submit).toHaveBeenCalledTimes(2)
    })

    test('guards synchronous submissions too', () => {
        const submit = jest.fn(() => 'done')
        const guarded = createSingleFlightSubmit(submit)

        expect(guarded()).toBe('done')
        expect(guarded()).toBe('done')
        expect(submit).toHaveBeenCalledTimes(1)
    })
})

describe('useSingleFlightSubmit', () => {
    test('keeps one guard across re-renders while calling the latest handler', () => {
        const submit = jest.fn(() => new Promise(() => {}))
        const guards = []

        function Harness({ value }) {
            const guarded = useSingleFlightSubmit(() => submit(value))
            guards.push(guarded)
            return null
        }

        let tree
        act(() => {
            tree = renderer.create(<Harness value="first render" />)
        })
        act(() => {
            tree.update(<Harness value="second render" />)
        })

        // Same guard instance, so state typed after the first render cannot
        // start a second creation.
        expect(guards[0]).toBe(guards[1])

        act(() => {
            guards[1]()
            guards[1]()
        })

        expect(submit).toHaveBeenCalledTimes(1)
        // The stable guard still runs the newest closure, not a stale one.
        expect(submit).toHaveBeenCalledWith('second render')
    })
})
