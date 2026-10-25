import { __resetGoldCounter, coinLanded, expectCoins, getDisplayedGold, SETTLE_MS } from './goldCounterBridge'

describe('gold counter while coins fly in', () => {
    beforeEach(() => {
        __resetGoldCounter()
        jest.useFakeTimers()
    })
    afterEach(() => jest.useRealTimers())

    it('counts up one coin at a time, even if the server was faster', () => {
        expectCoins(100, 3, 0)
        expect(getDisplayedGold(100, 1)).toBe(100)
        coinLanded(10)
        expect(getDisplayedGold(100, 11)).toBe(101)
        // The reward already reached the user document: still one coin at a time.
        coinLanded(20)
        expect(getDisplayedGold(103, 21)).toBe(102)
        coinLanded(30)
        expect(getDisplayedGold(103, 31)).toBe(103)
        // Caught up: back to the real balance.
        expect(getDisplayedGold(110, 40)).toBe(110)
    })

    it('holds the landed total until the server confirms', () => {
        expectCoins(50, 2, 0)
        coinLanded(1)
        coinLanded(2)
        expect(getDisplayedGold(50, 3)).toBe(52)
        expect(getDisplayedGold(52, 4)).toBe(52)
        expect(getDisplayedGold(60, 5)).toBe(60)
    })

    it('falls back to the real balance if the reward never arrives', () => {
        expectCoins(50, 2, 0)
        coinLanded(1)
        coinLanded(2)
        expect(getDisplayedGold(50, 2 + SETTLE_MS + 1)).toBe(50)
    })

    it('adds overlapping flights together', () => {
        expectCoins(10, 2, 0)
        coinLanded(1)
        expectCoins(10, 3, 2)
        coinLanded(3)
        coinLanded(4)
        expect(getDisplayedGold(10, 5)).toBe(13)
    })
})
