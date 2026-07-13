import moment from 'moment'

export const getCalendarTaskStartAndEndTimestamp = (calendarData, firstLoginDateInDay) => {
    const { start, end } = calendarData

    if (start.dateTime && end.dateTime) {
        return {
            startDateTimestamp: moment(start.dateTime).valueOf(),
            endDateTimestamp: moment(end.dateTime).valueOf(),
        }
    }

    return {
        startDateTimestamp: firstLoginDateInDay,
        endDateTimestamp: firstLoginDateInDay,
    }
}
