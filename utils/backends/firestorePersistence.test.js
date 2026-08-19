import { enableFirestorePersistence } from './firestorePersistence'

describe('enableFirestorePersistence', () => {
    let consoleWarn

    beforeEach(() => {
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
    })

    it('enables multi-tab persistence on the compat client', async () => {
        const db = { enablePersistence: jest.fn(() => Promise.resolve()) }

        await expect(enableFirestorePersistence(db)).resolves.toBe(true)
        expect(db.enablePersistence).toHaveBeenCalledWith({ synchronizeTabs: true })
    })

    it('skips persistence under the emulator (its IndexedDB is wiped every boot)', async () => {
        const db = { enablePersistence: jest.fn(() => Promise.resolve()) }

        await expect(enableFirestorePersistence(db, { useEmulator: true })).resolves.toBe(false)
        expect(db.enablePersistence).not.toHaveBeenCalled()
    })

    it.each(['failed-precondition', 'unimplemented'])(
        'degrades to the in-memory cache on %s without throwing',
        async code => {
            const db = { enablePersistence: jest.fn(() => Promise.reject({ code })) }

            await expect(enableFirestorePersistence(db)).resolves.toBe(false)
            expect(consoleWarn).toHaveBeenCalled()
        }
    )

    it('degrades on an unexpected rejection without throwing', async () => {
        const db = { enablePersistence: jest.fn(() => Promise.reject(new Error('boom'))) }

        await expect(enableFirestorePersistence(db)).resolves.toBe(false)
    })

    it('degrades when enablePersistence throws synchronously', async () => {
        const db = {
            enablePersistence: jest.fn(() => {
                throw new Error('called after other operations')
            }),
        }

        await expect(enableFirestorePersistence(db)).resolves.toBe(false)
    })

    it('degrades when the client has no enablePersistence at all', async () => {
        await expect(enableFirestorePersistence({})).resolves.toBe(false)
        await expect(enableFirestorePersistence(undefined)).resolves.toBe(false)
    })
})
