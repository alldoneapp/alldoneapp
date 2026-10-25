import { handleOptionalSnapshotError } from './optionalSnapshotError'

describe('handleOptionalSnapshotError', () => {
    it('applies the safe fallback', () => {
        const applyFallback = jest.fn()
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        handleOptionalSnapshotError('goal counter', { code: 'permission-denied' }, applyFallback)

        expect(applyFallback).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith(
            'Optional Firestore listener failed (goal counter):',
            expect.objectContaining({ code: 'permission-denied' })
        )
        warn.mockRestore()
    })
})
