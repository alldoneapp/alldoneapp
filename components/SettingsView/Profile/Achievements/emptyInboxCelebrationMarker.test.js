import {
    hasCelebratedEmptyInboxDay,
    markEmptyInboxDayCelebrated,
    resetEmptyInboxCelebrationSessionMarkers,
} from './emptyInboxCelebrationMarker'

const STORAGE_KEY = 'alldone.emptyInboxDayCelebration'

describe('emptyInboxCelebrationMarker', () => {
    beforeEach(() => {
        resetEmptyInboxCelebrationSessionMarkers()
        localStorage.clear()
    })

    it('answers per user and per day', () => {
        expect(hasCelebratedEmptyInboxDay('user-1', '2026-08-24')).toBe(false)

        markEmptyInboxDayCelebrated('user-1', '2026-08-24')

        expect(hasCelebratedEmptyInboxDay('user-1', '2026-08-24')).toBe(true)
        // A new day re-arms it — this is what makes the celebration a daily reward rather than a
        // one-off, and it is the only thing keeping the marker from growing a key per day.
        expect(hasCelebratedEmptyInboxDay('user-1', '2026-08-25')).toBe(false)
        // A second account on the same browser gets its own answer.
        expect(hasCelebratedEmptyInboxDay('user-2', '2026-08-24')).toBe(false)
    })

    it('survives a reload through localStorage', () => {
        markEmptyInboxDayCelebrated('user-1', '2026-08-24')
        // A reload keeps localStorage and loses the module-level session map, so this is the layer
        // under test.
        resetEmptyInboxCelebrationSessionMarkers()

        expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ 'user-1': '2026-08-24' })
        expect(hasCelebratedEmptyInboxDay('user-1', '2026-08-24')).toBe(true)
    })

    it('caps the stored map and drops the least recently celebrated account', () => {
        for (let index = 0; index < 10; index++) markEmptyInboxDayCelebrated(`user-${index}`, '2026-08-24')

        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))

        expect(Object.keys(stored)).toHaveLength(8)
        expect(stored['user-0']).toBeUndefined()
        expect(stored['user-1']).toBeUndefined()
        expect(stored['user-9']).toBe('2026-08-24')
    })

    it('re-inserts an existing account at the end rather than letting it age out', () => {
        markEmptyInboxDayCelebrated('user-old', '2026-08-24')
        for (let index = 0; index < 7; index++) markEmptyInboxDayCelebrated(`user-${index}`, '2026-08-24')
        // user-old is now the oldest key; celebrating it again on a new day must refresh its
        // position, not leave it first in line to be dropped.
        markEmptyInboxDayCelebrated('user-old', '2026-08-25')
        markEmptyInboxDayCelebrated('user-new', '2026-08-25')

        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))

        expect(stored['user-old']).toBe('2026-08-25')
        expect(stored['user-new']).toBe('2026-08-25')
    })

    it('still enforces once-per-session when storage is unavailable', () => {
        // Safari in private mode throws on access rather than returning null. Degrading to "no
        // memory at all" would replay the animation on every mount of the board.
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError')
        })
        const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('SecurityError')
        })

        try {
            markEmptyInboxDayCelebrated('user-1', '2026-08-24')

            expect(hasCelebratedEmptyInboxDay('user-1', '2026-08-24')).toBe(true)
            expect(hasCelebratedEmptyInboxDay('user-1', '2026-08-25')).toBe(false)
        } finally {
            getItem.mockRestore()
            setItem.mockRestore()
        }
    })

    it('treats a corrupt entry as no marker instead of throwing into the card', () => {
        localStorage.setItem(STORAGE_KEY, '{ not json')

        expect(hasCelebratedEmptyInboxDay('user-1', '2026-08-24')).toBe(false)

        markEmptyInboxDayCelebrated('user-1', '2026-08-24')

        expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ 'user-1': '2026-08-24' })
    })

    it('ignores a missing user id or day key', () => {
        expect(hasCelebratedEmptyInboxDay(undefined, '2026-08-24')).toBe(false)
        expect(hasCelebratedEmptyInboxDay('user-1', undefined)).toBe(false)

        markEmptyInboxDayCelebrated(undefined, '2026-08-24')
        markEmptyInboxDayCelebrated('user-1', undefined)

        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
})
