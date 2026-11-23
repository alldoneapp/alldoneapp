import {
    CALENDAR_SYNC_FAILED,
    CALENDAR_SYNC_SYNCED,
    CALENDAR_SYNC_SYNCING,
    CALENDAR_SYNC_UNKNOWN,
    getCalendarSyncStatuses,
    resetCalendarSyncStatuses,
    setCalendarSyncStatus,
    subscribeToCalendarSyncStatus,
    summarizeCalendarSyncStatus,
} from './calendarSyncStatus'

describe('calendarSyncStatus (AT-3136)', () => {
    afterEach(() => resetCalendarSyncStatuses())

    it('notifies listeners of a changed status only', () => {
        const listener = jest.fn()
        const unsubscribe = subscribeToCalendarSyncStatus(listener)

        setCalendarSyncStatus('p1', CALENDAR_SYNC_SYNCING)
        setCalendarSyncStatus('p1', CALENDAR_SYNC_SYNCING)
        setCalendarSyncStatus('p1', CALENDAR_SYNC_SYNCED)

        expect(listener).toHaveBeenCalledTimes(2)
        expect(getCalendarSyncStatuses()).toEqual({ p1: CALENDAR_SYNC_SYNCED })
        unsubscribe()
        setCalendarSyncStatus('p1', CALENDAR_SYNC_FAILED)
        expect(listener).toHaveBeenCalledTimes(2)
    })

    it('summarizes several connected calendars, failure first', () => {
        expect(summarizeCalendarSyncStatus([], {})).toBeNull()
        expect(summarizeCalendarSyncStatus(['a', 'b'], { a: 'synced', b: 'synced' })).toBe(CALENDAR_SYNC_SYNCED)
        expect(summarizeCalendarSyncStatus(['a', 'b'], { a: 'synced' })).toBe(CALENDAR_SYNC_UNKNOWN)
        expect(summarizeCalendarSyncStatus(['a', 'b'], { a: 'synced', b: 'syncing' })).toBe(CALENDAR_SYNC_SYNCING)
        expect(summarizeCalendarSyncStatus(['a', 'b'], { a: 'failed', b: 'syncing' })).toBe(CALENDAR_SYNC_FAILED)
    })
})
