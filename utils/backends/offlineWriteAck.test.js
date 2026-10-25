import { awaitWriteAck, isAppOffline } from './offlineWriteAck'
import * as connectionHealth from '../connectionHealth'

let mockConnectionState = ''
let mockConnectionHealth = 'live'
let mockHealthListeners
let finishLatencySample

jest.mock('../../redux/store', () => ({
    getState: () => ({ connectionState: mockConnectionState, connectionHealth: mockConnectionHealth }),
}))

jest.mock('../connectionHealth', () => ({
    markServerContact: jest.fn(),
    startConnectionLatencySample: jest.fn(),
    subscribeConnectionHealth: jest.fn(),
}))

const setBrowserOnline = online => {
    Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true })
}

describe('awaitWriteAck', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockConnectionState = ''
        mockConnectionHealth = 'live'
        mockHealthListeners = new Set()
        finishLatencySample = jest.fn()
        connectionHealth.startConnectionLatencySample.mockReturnValue(finishLatencySample)
        connectionHealth.subscribeConnectionHealth.mockImplementation(listener => {
            mockHealthListeners.add(listener)
            return () => mockHealthListeners.delete(listener)
        })
        setBrowserOnline(true)
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('is offline when either the redux slice or the browser says so', () => {
        expect(isAppOffline()).toBe(false)

        mockConnectionState = 'offline'
        expect(isAppOffline()).toBe(true)

        mockConnectionState = ''
        setBrowserOnline(false)
        expect(isAppOffline()).toBe(true)
    })

    it('uses the local write path when the server is stale or manually offline', () => {
        mockConnectionHealth = 'stale'
        expect(isAppOffline()).toBe(true)

        mockConnectionHealth = 'offline'
        expect(isAppOffline()).toBe(true)

        mockConnectionHealth = 'slow'
        expect(isAppOffline()).toBe(false)
    })

    it('waits for the server ack while online', async () => {
        let settled = false
        let resolveWrite
        const write = new Promise(resolve => {
            resolveWrite = resolve
        })

        const pending = awaitWriteAck(write, 'test write').then(() => {
            settled = true
        })

        await Promise.resolve()
        expect(settled).toBe(false)

        resolveWrite('acked')
        await pending
        expect(settled).toBe(true)
        expect(connectionHealth.startConnectionLatencySample).toHaveBeenCalledWith('write_ack')
        expect(connectionHealth.markServerContact).toHaveBeenCalledWith('write_ack')
        expect(finishLatencySample).toHaveBeenCalledTimes(1)
    })

    it('keeps waiting while slow, but releases the operation when the user chooses offline', async () => {
        let continued = false
        const pending = awaitWriteAck(new Promise(() => {}), 'slow write').then(value => {
            continued = true
            return value
        })

        mockHealthListeners.forEach(listener => listener('slow'))
        await Promise.resolve()
        expect(continued).toBe(false)

        mockHealthListeners.forEach(listener => listener('offline'))
        await expect(pending).resolves.toBeUndefined()
        expect(finishLatencySample).toHaveBeenCalledTimes(1)
        expect(mockHealthListeners.size).toBe(0)
    })

    it('resolves the online path with the write result', async () => {
        await expect(awaitWriteAck(Promise.resolve('acked'), 'test write')).resolves.toBe('acked')
    })

    it('does not wait for an ack that cannot arrive while offline', async () => {
        mockConnectionState = 'offline'
        // A write that NEVER resolves: offline that is exactly what a Firestore
        // write promise does until reconnect.
        const neverAcked = new Promise(() => {})

        await expect(awaitWriteAck(neverAcked, 'offline write')).resolves.toBeUndefined()
    })

    it('still issues the write while offline (it lands in the persisted mutation queue)', async () => {
        mockConnectionState = 'offline'
        const write = jest.fn(() => new Promise(() => {}))

        await awaitWriteAck(write(), 'offline write')

        expect(write).toHaveBeenCalledTimes(1)
    })

    it('swallows an offline write rejection instead of throwing at the caller', async () => {
        mockConnectionState = 'offline'

        await expect(awaitWriteAck(Promise.reject(new Error('nope')), 'offline write')).resolves.toBeUndefined()
        await Promise.resolve()
        expect(console.warn).toHaveBeenCalled()
    })

    it('propagates a genuine failure while online', async () => {
        await expect(awaitWriteAck(Promise.reject(new Error('permission denied')), 'online write')).rejects.toThrow(
            'permission denied'
        )
    })
})
