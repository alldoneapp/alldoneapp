import {
    NOTE_REFS_MAX_AGE_MS,
    createNoteUploadsCache,
    flushArtifactsLocalCache,
    getArtifactsListCacheKey,
    getLinkedUploadsCacheKey,
    getNoteUploadsSignature,
    loadCachedValue,
    readCachedValue,
    resetArtifactsLocalCacheForTests,
    writeCachedValue,
} from './artifactsLocalCache'

// The smallest IndexedDB the module uses: one object store, get and put, asynchronous callbacks.
function createIndexedDbDouble() {
    const rows = new Map()
    const later = callback => setTimeout(callback, 0)
    return {
        rows,
        open: () => {
            const request = {}
            later(() => {
                request.result = {
                    createObjectStore: jest.fn(),
                    close: jest.fn(),
                    transaction: () => {
                        const transaction = {
                            objectStore: () => ({
                                get: key => {
                                    const read = {}
                                    later(() => {
                                        read.result = rows.get(key)
                                        read.onsuccess?.()
                                    })
                                    return read
                                },
                                put: row => rows.set(row.key, JSON.parse(JSON.stringify(row))),
                            }),
                        }
                        later(() => transaction.oncomplete?.())
                        return transaction
                    },
                }
                request.onupgradeneeded?.()
                request.onsuccess?.()
            })
            return request
        },
    }
}

const originalIndexedDb = global.indexedDB
afterEach(() => {
    global.indexedDB = originalIndexedDb
    resetArtifactsLocalCacheForTests()
})

it('keys every list by the signed-in user, the project and the tab', () => {
    const keys = [
        getArtifactsListCacheKey('u1', 'p', false),
        getArtifactsListCacheKey('u1', 'p', true),
        getArtifactsListCacheKey('u2', 'p', false),
        getLinkedUploadsCacheKey('u1', 'p'),
        getLinkedUploadsCacheKey('u2', 'p'),
    ]
    expect(new Set(keys).size).toBe(keys.length)
})

it('answers from memory at once and works without IndexedDB', async () => {
    global.indexedDB = undefined
    expect(readCachedValue('k')).toBeUndefined()
    expect(await loadCachedValue('k')).toBeUndefined()
    writeCachedValue('k', [{ id: 'a' }])
    expect(readCachedValue('k')).toEqual([{ id: 'a' }])
    await expect(flushArtifactsLocalCache()).resolves.toBeUndefined()
})

it('keeps what was written for the next visit, after a reload', async () => {
    const database = createIndexedDbDouble()
    global.indexedDB = database
    writeCachedValue('k', [{ id: 'a' }])
    await flushArtifactsLocalCache()
    expect(database.rows.get('k').value).toEqual([{ id: 'a' }])

    // A reload empties memory; the stored list is still there.
    resetArtifactsLocalCacheForTests()
    expect(readCachedValue('k')).toBeUndefined()
    expect(await loadCachedValue('k')).toEqual([{ id: 'a' }])
    expect(readCachedValue('k')).toEqual([{ id: 'a' }])
})

it('prefers what this session wrote over an older stored value read at the same time', async () => {
    const database = createIndexedDbDouble()
    database.rows.set('k', { key: 'k', value: ['old'] })
    global.indexedDB = database
    const loading = loadCachedValue('k')
    writeCachedValue('k', ['new'])
    expect(await loading).toEqual(['new'])
})

it('treats a wedged database as an empty one instead of waiting for it', async () => {
    jest.useFakeTimers()
    try {
        global.indexedDB = { open: () => ({}) }
        const loading = loadCachedValue('k')
        jest.advanceTimersByTime(2000)
        await expect(loading).resolves.toBeUndefined()
    } finally {
        jest.useRealTimers()
    }
})

describe('note attachments', () => {
    it('names a note body by the two stamps that move when it changes', () => {
        expect(getNoteUploadsSignature({ lastEditionDate: 5, uploadsRevision: 'r2' })).toBe('5|r2')
        expect(getNoteUploadsSignature({})).toBe('0|')
    })

    it('returns the attachments only for the same edition, and not once they are old', async () => {
        global.indexedDB = undefined
        let now = 1000
        const cache = createNoteUploadsCache('u', 'p', { now: () => now })
        await cache.set('n', '5|', [{ path: 'notesAttachments/n/a.png' }])
        expect(await cache.get('n', '5|')).toEqual([{ path: 'notesAttachments/n/a.png' }])
        expect(await cache.get('n', '6|')).toBeNull()
        expect(await cache.get('other', '5|')).toBeNull()

        // Shared by the next watcher of the same project in this session.
        expect(await createNoteUploadsCache('u', 'p', { now: () => now }).get('n', '5|')).toHaveLength(1)
        expect(await createNoteUploadsCache('someone-else', 'p', { now: () => now }).get('n', '5|')).toBeNull()

        now += NOTE_REFS_MAX_AGE_MS
        expect(await cache.get('n', '5|')).toBeNull()
    })
})
