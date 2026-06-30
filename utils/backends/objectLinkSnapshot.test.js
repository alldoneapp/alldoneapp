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
