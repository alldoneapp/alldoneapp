jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
}))

const admin = require('firebase-admin')
const {
    DEFAULT_MIN_FREE_HOURS_PER_DAY,
    dayKeepsMinimumFreeTime,
    getMinFreeHoursPerDayForUser,
    minFreeHoursToMinutes,
    normalizeMinFreeHoursPerDay,
    sumBusyMinutesInWindow,
} = require('./dailyFreeTime')

const HOUR = 60 * 60 * 1000

describe('normalizeMinFreeHoursPerDay', () => {
    test('defaults to 4 hours for missing, empty, and unparseable values', () => {
        expect(DEFAULT_MIN_FREE_HOURS_PER_DAY).toBe(4)
        expect(normalizeMinFreeHoursPerDay(undefined)).toBe(4)
        expect(normalizeMinFreeHoursPerDay(null)).toBe(4)
        expect(normalizeMinFreeHoursPerDay('')).toBe(4)
        expect(normalizeMinFreeHoursPerDay('not a number')).toBe(4)
        expect(normalizeMinFreeHoursPerDay(-1)).toBe(4)
        expect(normalizeMinFreeHoursPerDay(NaN)).toBe(4)
    })

    test('keeps explicit values including 0, accepts numeric strings and halves', () => {
        expect(normalizeMinFreeHoursPerDay(0)).toBe(0)
        expect(normalizeMinFreeHoursPerDay('0')).toBe(0)
        expect(normalizeMinFreeHoursPerDay(3.5)).toBe(3.5)
        expect(normalizeMinFreeHoursPerDay('6')).toBe(6)
        expect(normalizeMinFreeHoursPerDay('2.755')).toBe(2.76)
    })

    test('clamps to a calendar day and honours an explicit fallback', () => {
        expect(normalizeMinFreeHoursPerDay(48)).toBe(24)
        expect(normalizeMinFreeHoursPerDay(undefined, 2)).toBe(2)
        expect(minFreeHoursToMinutes(4)).toBe(240)
    })
})

describe('sumBusyMinutesInWindow', () => {
    test('counts only the overlap with the window', () => {
        const intervals = [
            { startMs: 8 * HOUR, endMs: 10 * HOUR },
            { startMs: 12 * HOUR, endMs: 13 * HOUR },
            { startMs: 20 * HOUR, endMs: 21 * HOUR },
        ]

        expect(sumBusyMinutesInWindow(intervals, 9 * HOUR, 17 * HOUR)).toBe(120)
    })

    test('is zero for an empty or inverted window', () => {
        expect(sumBusyMinutesInWindow([], 9 * HOUR, 17 * HOUR)).toBe(0)
        expect(sumBusyMinutesInWindow([{ startMs: 0, endMs: HOUR }], 17 * HOUR, 9 * HOUR)).toBe(0)
    })
})

describe('dayKeepsMinimumFreeTime', () => {
    const day = { capacityMinutes: 480, durationMinutes: 30, minFreeMinutes: 240 }

    test('allows a day that still keeps the minimum after the meeting', () => {
        expect(dayKeepsMinimumFreeTime({ ...day, busyMinutes: 120 })).toBe(true)
    })

    test('accepts the exact boundary despite float arithmetic', () => {
        // 8h window, 3.5h booked, 30min meeting -> exactly 4h left.
        expect(dayKeepsMinimumFreeTime({ ...day, busyMinutes: 210 })).toBe(true)
    })

    test('rejects a day where the meeting would eat into the minimum', () => {
        expect(dayKeepsMinimumFreeTime({ ...day, busyMinutes: 240 })).toBe(false)
    })

    test('is disabled by a zero minimum', () => {
        expect(dayKeepsMinimumFreeTime({ ...day, busyMinutes: 470, minFreeMinutes: 0 })).toBe(true)
    })
})

describe('getMinFreeHoursPerDayForUser', () => {
    function mockSettingsDoc(implementation) {
        const get = jest.fn(implementation)
        admin.firestore.mockReturnValue({ doc: jest.fn(() => ({ get })) })
        return get
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('reads the saved value from the meeting settings doc', async () => {
        mockSettingsDoc(async () => ({ exists: true, data: () => ({ minFreeHoursPerDay: 6 }) }))
        await expect(getMinFreeHoursPerDayForUser('user-1')).resolves.toBe(6)
    })

    test('falls back to the default when the doc, the field, or the user is missing', async () => {
        mockSettingsDoc(async () => ({ exists: false }))
        await expect(getMinFreeHoursPerDayForUser('user-1')).resolves.toBe(4)

        mockSettingsDoc(async () => ({ exists: true, data: () => ({}) }))
        await expect(getMinFreeHoursPerDayForUser('user-1')).resolves.toBe(4)

        await expect(getMinFreeHoursPerDayForUser('')).resolves.toBe(4)
    })

    test('fails soft to the default when the settings read throws', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        mockSettingsDoc(async () => {
            throw new Error('firestore unavailable')
        })

        await expect(getMinFreeHoursPerDayForUser('user-1')).resolves.toBe(4)
        console.warn.mockRestore()
    })
})
