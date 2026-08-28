import { enableFirestorePersistence } from './firestorePersistence'

jest.mock('firebase/firestore', () => ({
    persistentLocalCache: jest.fn(options => ({ kind: 'persistent', options })),
    persistentMultipleTabManager: jest.fn(() => ({ kind: 'multi-tab' })),
}))

describe('enableFirestorePersistence', () => {
    let consoleWarn

    beforeEach(() => {
        window.history.replaceState({}, '', '/')
        localStorage.clear()
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
    })

    it('configures a bounded multi-tab persistent cache on the compat client', async () => {
        const db = { settings: jest.fn() }

        await expect(enableFirestorePersistence(db)).resolves.toBe(true)
        expect(db.settings).toHaveBeenCalledWith({
            merge: true,
            localCache: {
                kind: 'persistent',
                options: {
                    cacheSizeBytes: 100 * 1024 * 1024,
                    tabManager: { kind: 'multi-tab' },
                },
            },
        })
    })

    it('skips persistence under the emulator (its IndexedDB is wiped every boot)', async () => {
        const db = { settings: jest.fn() }

        await expect(enableFirestorePersistence(db, { useEmulator: true })).resolves.toBe(false)
        expect(db.settings).not.toHaveBeenCalled()
    })

    it('supports an explicit diagnostic run without persistent cache', async () => {
        window.history.replaceState({}, '', '/?perfDisablePersistence=1')
        const db = { settings: jest.fn() }

        await expect(enableFirestorePersistence(db)).resolves.toBe(false)
        expect(db.settings).not.toHaveBeenCalled()
    })

    it('degrades when persistent cache configuration throws synchronously', async () => {
        const db = {
            settings: jest.fn(() => {
                throw new Error('called after other operations')
            }),
        }

        await expect(enableFirestorePersistence(db)).resolves.toBe(false)
    })

    it('degrades when the client has no settings API at all', async () => {
        await expect(enableFirestorePersistence({})).resolves.toBe(false)
        await expect(enableFirestorePersistence(undefined)).resolves.toBe(false)
    })
})
