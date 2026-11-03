import { shouldProcessObjectLinkSnapshot } from './objectLinkSnapshot'

describe('shouldProcessObjectLinkSnapshot', () => {
    it('waits for the server when an object is absent only from the local cache', () => {
        expect(shouldProcessObjectLinkSnapshot(undefined, { fromCache: true })).toBe(false)
    })

    it('processes cached objects immediately', () => {
        expect(shouldProcessObjectLinkSnapshot({ title: 'Note title' }, { fromCache: true })).toBe(true)
    })

    it('processes authoritative missing-object snapshots', () => {
        expect(shouldProcessObjectLinkSnapshot(undefined, { fromCache: false })).toBe(true)
    })
})

describe('getObjectLinkRetryDelay (AT-2950)', () => {
    const { getObjectLinkRetryDelay, OBJECT_LINK_RETRY_DELAYS_MS } = require('./objectLinkSnapshot')

    it('backs off for a bounded number of failed listeners', () => {
        expect(OBJECT_LINK_RETRY_DELAYS_MS.length).toBeGreaterThan(0)
        OBJECT_LINK_RETRY_DELAYS_MS.forEach((delay, attempt) => {
            expect(getObjectLinkRetryDelay(attempt)).toBe(delay)
        })
        expect(getObjectLinkRetryDelay(OBJECT_LINK_RETRY_DELAYS_MS.length)).toBeNull()
        expect(getObjectLinkRetryDelay(-1)).toBeNull()
        expect(getObjectLinkRetryDelay(undefined)).toBeNull()
    })
})
