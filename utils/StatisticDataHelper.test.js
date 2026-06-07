import { getSafeStatisticNumber } from './StatisticDataHelper'

describe('StatisticDataHelper', () => {
    it('keeps valid numeric statistics', () => {
        expect(getSafeStatisticNumber(3)).toBe(3)
        expect(getSafeStatisticNumber('4.5')).toBe(4.5)
    })

    it('falls back to zero for object-shaped statistics', () => {
        expect(getSafeStatisticNumber({ operand: 1 })).toBe(0)
        expect(getSafeStatisticNumber({})).toBe(0)
    })
})
