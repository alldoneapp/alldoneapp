const {
    OKR_CADENCE_MONTHLY,
    OKR_STATUS_ACTIVE,
    OKR_STATUS_CLOSED,
    OKR_TYPE_MANUAL,
    OKR_TYPE_TIME_LOGGED_REVENUE,
    calculateRevenueOkrCurrentValue,
    calculateOkrProgress,
    getNextOkrPeriod,
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
            progress: 50,
        })
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
})
