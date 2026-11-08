import { ARTIFACTS_CACHE_DATABASE, clearAccountLocalData, releasePushToken, withTimeout } from './logoutCleanup'

const fakeIndexedDb = names => {
    const deleted = []
    return {
        deleted,
        databases: jest.fn(async () => names.map(name => ({ name }))),
        deleteDatabase: jest.fn(name => {
            deleted.push(name)
            const request = {}
            setTimeout(() => request.onsuccess && request.onsuccess(), 0)
            return request
        }),
    }
}

describe('logout cleanup (security audit NV-41/NV-42)', () => {
    beforeEach(() => {
        global.Notification = { permission: 'granted' }
    })
    afterEach(() => {
        delete global.Notification
    })

    test('removes this browser token from the account and deletes it at FCM', async () => {
        const messaging = { getToken: jest.fn(async () => 'tok-1'), deleteToken: jest.fn(async () => true) }
        const userRef = { update: jest.fn(async () => {}) }
        const arrayRemove = jest.fn(value => ({ remove: value }))
        await releasePushToken({ messaging, isMessagingSupported: true, userRef, arrayRemove })
        expect(userRef.update).toHaveBeenCalledWith({ fcmToken: { remove: 'tok-1' } })
        expect(messaging.deleteToken).toHaveBeenCalled()
    })

    test('never prompts for notification permission during logout', async () => {
        global.Notification = { permission: 'default' }
        const messaging = { getToken: jest.fn(), deleteToken: jest.fn(async () => true) }
        const userRef = { update: jest.fn() }
        await releasePushToken({ messaging, isMessagingSupported: true, userRef, arrayRemove: v => v })
        expect(messaging.getToken).not.toHaveBeenCalled()
        expect(userRef.update).not.toHaveBeenCalled()
    })

    test('a write that never acknowledges (offline) cannot hang the logout', async () => {
        const messaging = { getToken: jest.fn(async () => 'tok-1'), deleteToken: jest.fn(() => new Promise(() => {})) }
        const userRef = { update: jest.fn(() => new Promise(() => {})) }
        const started = Date.now()
        await releasePushToken({ messaging, isMessagingSupported: true, userRef, arrayRemove: v => v, timeoutMs: 20 })
        expect(Date.now() - started).toBeLessThan(1000)
    })

    test('terminates Firestore, clears its cache, the note and artifact stores and the cached user', async () => {
        const order = []
        const db = {
            terminate: jest.fn(async () => order.push('terminate')),
            clearPersistence: jest.fn(async () => order.push('clearPersistence')),
        }
        const indexedDB = fakeIndexedDb(['alldone-note-n1', 'alldone-note-n2', 'firestore/[DEFAULT]/x/main'])
        const clearUserDataCache = jest.fn()
        await clearAccountLocalData({ db, indexedDB, clearUserDataCache })
        expect(order).toEqual(['terminate', 'clearPersistence'])
        expect(clearUserDataCache).toHaveBeenCalled()
        expect(indexedDB.deleted.sort()).toEqual([ARTIFACTS_CACHE_DATABASE, 'alldone-note-n1', 'alldone-note-n2'])
    })

    test('a failing clearPersistence (another tab open) does not stop the rest', async () => {
        const db = {
            terminate: jest.fn(async () => {}),
            clearPersistence: jest.fn(async () => {
                throw new Error('failed-precondition')
            }),
        }
        const indexedDB = fakeIndexedDb(['alldone-note-n1'])
        await clearAccountLocalData({ db, indexedDB, clearUserDataCache: () => {} })
        expect(indexedDB.deleted).toContain('alldone-note-n1')
    })

    test('withTimeout swallows errors', async () => {
        await expect(
            withTimeout(() => {
                throw new Error('boom')
            })
        ).resolves.toBeUndefined()
    })
})
