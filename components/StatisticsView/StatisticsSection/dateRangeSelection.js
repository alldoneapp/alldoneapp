import moment from 'moment'

import { colors } from '../../styles/global'

/**
 * The tap-to-build-a-range reducer behind CustomDateRangeModal, extracted
 * verbatim from its inline onDayPress (it was the largest untested branch of
 * the calendar consolidation). Given the current `markedDates` period map,
 * whether a range start exists, and the pressed day, it returns the next map:
 *
 * - first tap starts a one-day range (startingDay + endingDay)
 * - tapping after the end extends the range to the tapped day
 * - tapping inside the range shrinks it to end on the tapped day
 * - tapping the end day steps the end back one day
 * - tapping the start day clears the selection
 * - tapping before the start is ignored
 *
 * Pure: never mutates its inputs (the original mutated nested day objects
 * shared with the previous state — same output, subtler rerender risk).
 */
export const computeDateRangeSelection = (stateMarkedDates, hasFirstDay, dateString) => {
    const markedDates = {}
    for (const date in stateMarkedDates) markedDates[date] = { ...stateMarkedDates[date] }

    const previousDate = moment(dateString, 'YYYY-MM-DD').subtract(1, 'day').format('YYYY-MM-DD')

    if (dateString in markedDates) {
        if (markedDates[dateString].startingDay) {
            return { markedDates: {}, hasFirstDay: false }
        }
        if (markedDates[dateString].endingDay) {
            markedDates[previousDate].endingDay = true
            delete markedDates[dateString]
            return { markedDates, hasFirstDay }
        }
        markedDates[dateString].endingDay = true
        const endDate = moment(dateString, 'YYYY-MM-DD')
        for (const date in markedDates) {
            if (moment(date, 'YYYY-MM-DD').diff(endDate, 'days') > 0) delete markedDates[date]
        }
        return { markedDates, hasFirstDay }
    }

    if (hasFirstDay) {
        let endDate
        for (const date in markedDates) {
            if (markedDates[date].endingDay) endDate = moment(date, 'YYYY-MM-DD')
        }
        const pressedDate = moment(dateString, 'YYYY-MM-DD')
        const diff = pressedDate.diff(endDate, 'days') + 1
        if (diff > 0) {
            markedDates[endDate.format('YYYY-MM-DD')].endingDay = false
            for (let i = 1; i < diff - 1; i++) {
                markedDates[endDate.clone().add(i, 'day').format('YYYY-MM-DD')] = {
                    color: colors.Primary200,
                    selected: true,
                    startingDay: false,
                    endingDay: false,
                }
            }
            markedDates[
                endDate
                    .clone()
                    .add(diff - 1, 'day')
                    .format('YYYY-MM-DD')
            ] = {
                color: colors.Primary200,
                selected: true,
                startingDay: false,
                endingDay: true,
            }
        }
        return { markedDates, hasFirstDay }
    }

    markedDates[dateString] = {
        startingDay: true,
        color: colors.Primary200,
        selected: true,
        endingDay: true,
    }
    return { markedDates, hasFirstDay: true }
}
