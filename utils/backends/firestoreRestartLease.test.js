/** @jest-environment jsdom */

import {
    isFirestoreRestartInFlight,
    resetFirestoreRestartLeaseForTests,
    runExclusiveFirestoreRestart,
} from './firestoreRestartLease'

describe('runExclusiveFirestoreRestart', () => {
    beforeEach(() => {
        resetFirestoreRestartLeaseForTests()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        resetFirestoreRestartLeaseForTests()
        console.warn.mockRestore()
    })

    it('runs the restart and reports success', async () => {
        const restart = jest.fn().mockResolvedValue(undefined)
        await expect(runExclusiveFirestoreRestart(restart)).resolves.toBe(true)
        expect(restart).toHaveBeenCalledTimes(1)
    })

    it('joins an in-flight restart instead of starting a second one', async () => {
        // This is the whole point: the healer and connection health can both decide
        // the transport is broken at the same moment. Two interleaved
        // disable/enable pairs resolve in SDK call order, and one ordering leaves
        // the network parked for the rest of the session.
        let release
        const first = jest.fn(() => new Promise(resolve => (release = resolve)))
        const second = jest.fn().mockResolvedValue(undefined)

        const a = runExclusiveFirestoreRestart(first)
        const b = runExclusiveFirestoreRestart(second)

        expect(isFirestoreRestartInFlight()).toBe(true)
        release()
        await Promise.all([a, b])

        expect(first).toHaveBeenCalledTimes(1)
        expect(second).not.toHaveBeenCalled()
    })

    it('releases the lease so a later restart can run', async () => {
        const first = jest.fn().mockResolvedValue(undefined)
        const second = jest.fn().mockResolvedValue(undefined)

        await runExclusiveFirestoreRestart(first)
        expect(isFirestoreRestartInFlight()).toBe(false)
        await runExclusiveFirestoreRestart(second)

        expect(second).toHaveBeenCalledTimes(1)
    })

    it('never rejects, and reports a failed restart as false', async () => {
        const restart = jest.fn().mockRejectedValue(new Error('nope'))

        await expect(runExclusiveFirestoreRestart(restart)).resolves.toBe(false)
        // A failure must still release the lease — otherwise one bad restart would
        // block every future recovery attempt for the life of the session.
        expect(isFirestoreRestartInFlight()).toBe(false)
    })
})
