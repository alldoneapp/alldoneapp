const {
    OKR_CADENCE_MONTHLY,
    OKR_STATUS_ACTIVE,
    OKR_STATUS_CLOSED,
    calculateOkrProgress,
    getNextOkrPeriod,
    mapOKRData,
    normalizeStatus,
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
            progress: 50,
        })
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
