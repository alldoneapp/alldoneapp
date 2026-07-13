import moment from 'moment'

export const isAllDayCalendarEvent = calendarData =>
    Boolean(calendarData?.start?.date && !calendarData?.start?.dateTime)

export const getCalendarTagText = (calendarData, timeFormat, compact = false) => {
    if (isAllDayCalendarEvent(calendarData)) return 'All day'

    const startDate = moment(calendarData.start.dateTime)
    const endDate = moment(calendarData.end.dateTime)

    return compact ? startDate.format(timeFormat) : `${startDate.format(timeFormat)} - ${endDate.format(timeFormat)}`
}
