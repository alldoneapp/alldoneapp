import { computeDateRangeSelection } from './dateRangeSelection'

const range = (state, presses) => {
    let markedDates = state
    let hasFirstDay = Object.values(state).some(day => day.startingDay)
    for (const press of presses) {
        ;({ markedDates, hasFirstDay } = computeDateRangeSelection(markedDates, hasFirstDay, press))
    }
    return { markedDates, hasFirstDay }
}

describe('computeDateRangeSelection', () => {
    it('starts a one-day range on the first tap', () => {
        const { markedDates, hasFirstDay } = range({}, ['2026-08-10'])
        expect(hasFirstDay).toBe(true)
        expect(markedDates['2026-08-10']).toMatchObject({ startingDay: true, endingDay: true, selected: true })
    })

    it('extends the range forward to a later tap', () => {
        const { markedDates } = range({}, ['2026-08-10', '2026-08-13'])
        expect(Object.keys(markedDates).sort()).toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'])
        expect(markedDates['2026-08-10'].startingDay).toBe(true)
        expect(markedDates['2026-08-10'].endingDay).toBe(false)
        expect(markedDates['2026-08-13'].endingDay).toBe(true)
        expect(markedDates['2026-08-11']).toMatchObject({ startingDay: false, endingDay: false, selected: true })
    })

    it('ignores a tap before the range start', () => {
        const { markedDates } = range({}, ['2026-08-10', '2026-08-05'])
        expect(Object.keys(markedDates)).toEqual(['2026-08-10'])
    })

    it('shrinks the range when tapping inside it', () => {
        const { markedDates } = range({}, ['2026-08-10', '2026-08-14', '2026-08-12'])
        expect(Object.keys(markedDates).sort()).toEqual(['2026-08-10', '2026-08-11', '2026-08-12'])
        expect(markedDates['2026-08-12'].endingDay).toBe(true)
    })

    it('steps the end back one day when tapping the end day', () => {
        const { markedDates } = range({}, ['2026-08-10', '2026-08-12', '2026-08-12'])
        expect(Object.keys(markedDates).sort()).toEqual(['2026-08-10', '2026-08-11'])
        expect(markedDates['2026-08-11'].endingDay).toBe(true)
    })

    it('clears the selection when tapping the start day', () => {
        const { markedDates, hasFirstDay } = range({}, ['2026-08-10', '2026-08-13', '2026-08-10'])
        expect(markedDates).toEqual({})
        expect(hasFirstDay).toBe(false)
    })

    it('never mutates the previous state', () => {
        const first = computeDateRangeSelection({}, false, '2026-08-10')
        const frozen = JSON.parse(JSON.stringify(first.markedDates))
        computeDateRangeSelection(first.markedDates, first.hasFirstDay, '2026-08-13')
        computeDateRangeSelection(first.markedDates, first.hasFirstDay, '2026-08-10')
        expect(first.markedDates).toEqual(frozen)
    })
})
