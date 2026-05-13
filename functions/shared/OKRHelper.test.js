const {
    OKR_CADENCE_DAILY,
    OKR_CADENCE_MONTHLY,
    OKR_STATUS_ACTIVE,
    OKR_STATUS_CLOSED,
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
    OKR_PACE_AHEAD,
    OKR_PACE_AT_RISK,
    OKR_PACE_COMPLETED,
    OKR_PACE_ENDED,
    OKR_PACE_OFF_TRACK,
    OKR_PACE_ON_TRACK,
    calculateOkrPace,
    calculateRevenueOkrCurrentValue,
    calculateOkrProgress,
    getNextOkrPeriod,
    getOkrIsPublicFor,
    isOkrPrivate,
    mapOKRData,
    normalizeOkrType,
    normalizeStatus,
    resolveOkrDataForProject,
} = require('./OKRHelper')

describe('OKRHelper', () => {
    test('calculates and clamps progress', () => {
        expect(calculateOkrProgress(25, 100)).toBe(25)
        expect(calculateOkrProgress(125, 100)).toBe(100)
        expect(calculateOkrProgress(-10, 100)).toBe(0)
        expect(calculateOkrProgress(10, 0)).toBe(0)
    })

    test('calculates expected linear pace with app thresholds', () => {
        const base = { targetValue: 100, periodStart: 0, periodEnd: 1000 }

        expect(calculateOkrPace({ ...base, currentValue: 100 }, 500)).toMatchObject({
            actualPercent: 100,
            expectedPercent: 50,
            delta: 50,
            status: OKR_PACE_COMPLETED,
            label: 'Completed',
        })
        expect(calculateOkrPace({ ...base, currentValue: 60 }, 500).status).toBe(OKR_PACE_AHEAD)
        expect(calculateOkrPace({ ...base, currentValue: 45 }, 500).status).toBe(OKR_PACE_ON_TRACK)
        expect(calculateOkrPace({ ...base, currentValue: 30 }, 500).status).toBe(OKR_PACE_AT_RISK)
        expect(calculateOkrPace({ ...base, currentValue: 29 }, 500).status).toBe(OKR_PACE_OFF_TRACK)
        expect(calculateOkrPace({ ...base, currentValue: 25 }, 1500).status).toBe(OKR_PACE_ENDED)
    })

    test('maps OKR data with defaults', () => {
        const okr = mapOKRData('okr-1', {
            label: 'Revenue',
            currentValue: 5,
            targetValue: 10,
            ownerId: 'user-1',
        })

        expect(okr).toMatchObject({
            id: 'okr-1',
            objectType: 'okr',
            label: 'Revenue',
            ownerId: 'user-1',
            cadence: OKR_CADENCE_MONTHLY,
            status: OKR_STATUS_ACTIVE,
            type: OKR_TYPE_MANUAL,
            isPrivate: false,
            isPublicFor: [0],
            progress: 50,
        })
    })

    test('maps OKR privacy fields', () => {
        const okr = mapOKRData('okr-1', {
            ownerId: 'user-1',
            isPrivate: true,
            isPublicFor: ['user-1'],
        })

        expect(getOkrIsPublicFor(okr)).toEqual(['user-1'])
        expect(isOkrPrivate(okr)).toBe(true)
    })

    test('normalizes OKR types and calculates revenue current value', () => {
        expect(normalizeOkrType()).toBe(OKR_TYPE_MANUAL)
        expect(normalizeOkrType(OKR_TYPE_TIME_LOGGED_REVENUE)).toBe(OKR_TYPE_TIME_LOGGED_REVENUE)
        expect(calculateRevenueOkrCurrentValue(90, 100)).toBe(150)
        expect(calculateRevenueOkrCurrentValue(90, 0)).toBe(0)
    })

    test('resolves revenue OKR current value from owner time and hourly rate', async () => {
        const db = {
            collection: jest.fn(() => ({
                where: jest.fn().mockReturnThis(),
                get: jest.fn(async () => ({
                    docs: [{ data: () => ({ doneTime: 60 }) }, { data: () => ({ doneTime: 30 }) }],
                })),
            })),
        }

        const okr = await resolveOkrDataForProject(
            db,
            {
                id: 'project-1',
                estimationType: 'TIME',
                hourlyRatesData: { currency: 'EUR', hourlyRates: { 'user-1': 100, 'user-2': 200 } },
            },
            {
                id: 'okr-1',
                type: OKR_TYPE_TIME_LOGGED_REVENUE,
                ownerId: 'user-1',
                currentValue: 0,
                targetValue: 300,
                periodStart: Date.UTC(2026, 0, 1),
                periodEnd: Date.UTC(2026, 0, 31),
            }
        )

        expect(okr.currentValue).toBe(150)
        expect(okr.progress).toBe(50)
        expect(okr.unit).toBe('EUR')
    })

    test('normalizes valid statuses and rejects invalid status', () => {
        expect(normalizeStatus()).toBe(OKR_STATUS_ACTIVE)
        expect(normalizeStatus(OKR_STATUS_CLOSED)).toBe(OKR_STATUS_CLOSED)
        expect(() => normalizeStatus('deleted')).toThrow('Invalid OKR status')
    })

    test('gets next monthly period after ended period', () => {
        const next = getNextOkrPeriod(OKR_CADENCE_MONTHLY, Date.UTC(2026, 4, 31, 23, 59, 59, 999))
        expect(new Date(next.periodStart).getUTCMonth()).toBe(5)
    })

    test('gets next daily period after ended period', () => {
        const next = getNextOkrPeriod(OKR_CADENCE_DAILY, Date.UTC(2026, 4, 12, 23, 59, 59, 999), {
            timezone: 'UTC',
        })
        expect(new Date(next.periodStart).getUTCDate()).toBe(13)
        expect(new Date(next.periodEnd).getUTCHours()).toBe(23)
    })
})
