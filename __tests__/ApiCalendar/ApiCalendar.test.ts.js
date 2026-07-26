// The module on disk is apiCalendar.js. Importing it as ApiCalendar resolved
// only because macOS is case-insensitive; it would not resolve on the Linux CI
// runner.
import ApiCalendar from '../../apis/google/calendar/apiCalendar'

describe('ApiCalendar', () => {
    afterEach(() => {
        ApiCalendar.calendar = 'primary'
    })

    it('defaults to the primary calendar', () => {
        expect(ApiCalendar.calendar).toBe('primary')
    })

    it('takes the calendar it is pointed at', () => {
        // setCalendar is gone; the calendar is a plain field now.
        ApiCalendar.calendar = 'test-calendar'

        expect(ApiCalendar.calendar).toBe('test-calendar')
    })
})
