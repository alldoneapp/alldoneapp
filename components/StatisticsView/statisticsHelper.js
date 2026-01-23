import moment from 'moment'
import { getDateFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'

export const STATISTIC_RANGE_TODAY = 'Just today' // Just today
export const STATISTIC_RANGE_LAST_7_DAYS = 'Last 7 days' // Last 7 days
export const STATISTIC_RANGE_LAST_14_DAYS = 'Last 14 days' // Last 14 days
export const STATISTIC_RANGE_LAST_MONTH = 'Last month' // Last month
export const STATISTIC_RANGE_CURRENT_MONTH = 'Current month' // Current month
export const STATISTIC_RANGE_CUSTOM = 'Custom' // Custom
export const STATISTIC_RANGE_ALL = 'All' // All

export function parseNumberToUseThousand(number) {
    return Math.floor(number).toLocaleString()
}

export function getStatisticsFilterData(filterOption, customDateRange) {
    const dateRange = []
    if (customDateRange && customDateRange.length > 0) {
        const date1 = customDateRange[0]
        const date2 = customDateRange[customDateRange.length - 1]
        dateRange.push(moment(date1, 'YYYY-MM-DD').valueOf())
        dateRange.push(moment(date2, 'YYYY-MM-DD').valueOf())
    }
    return { filter: filterOption, customDateRange: dateRange }
}

export function getFilterOption(filterData) {
    const { filter, customDateRange } = filterData
    if (filter === 'Custom') {
        const date1 = moment(customDateRange[0]).format(getDateFormat())
        const date2 = moment(customDateRange[customDateRange.length - 1]).format(getDateFormat())
        return `${date1}-${date2}`
    }
    return filter
}

export function getDateRangesTimestamps(filterData, getMoments = false) {
    const { filter, customDateRange } = filterData
    let startDay, endDay
    if (filter === 'Just today') {
        startDay = moment()
        endDay = moment()
    } else if (filter === 'Last 7 days') {
        startDay = moment().subtract(1, 'week')
        endDay = moment()
    } else if (filter === 'Last 14 days') {
        startDay = moment().subtract(2, 'weeks')
        endDay = moment()
    } else if (filter === 'Last month') {
        startDay = moment().subtract(1, 'month').startOf('month')
        endDay = startDay.clone().add(startDay.daysInMonth() - 1, 'day')
    } else if (filter === 'Current month') {
        startDay = moment().startOf('month')
        endDay = startDay.clone().add(startDay.daysInMonth() - 1, 'day')
    } else if (filter === 'Custom') {
        startDay = moment(customDateRange[0])
        endDay = moment(customDateRange[customDateRange.length - 1])
    } else if (filter === 'All') {
        startDay = moment(0)
        endDay = moment()
    }
    const timestamp1 = startDay.startOf('day')
    const timestamp2 = endDay.endOf('day')
    return {
        timestamp1: getMoments ? timestamp1 : timestamp1.valueOf(),
        timestamp2: getMoments ? timestamp2 : timestamp2.valueOf(),
    }
}
