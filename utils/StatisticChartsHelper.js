import moment from 'moment'
import store from '../redux/store'
import {
    PROJECT_COLOR_BLUE,
    PROJECT_COLOR_DEFAULT,
    PROJECT_COLOR_GREEN,
    PROJECT_COLOR_LIME,
    PROJECT_COLOR_ORANGE,
    PROJECT_COLOR_PELOROUS,
    PROJECT_COLOR_PINK,
    PROJECT_COLOR_PURPLE,
    PROJECT_COLOR_RED,
    PROJECT_COLOR_VIOLET,
    PROJECT_COLOR_YELLOW,
} from '../Themes/Modern/ProjectColors'

import tinycolor from 'tinycolor2'

export const STATISTIC_CHART_DONE_TASKS = 'CHART_DONE_TASKS'
export const STATISTIC_CHART_DONE_POINTS = 'CHART_DONE_POINTS'
export const STATISTIC_CHART_DONE_TIME = 'CHART_DONE_TIME'
export const STATISTIC_CHART_GOLD = 'CHART_GOLD'
export const STATISTIC_CHART_XP = 'CHART_XP'

export const getDataForCharts = (data, format, unit, dateList) => {
    const dataArray = transformObjectToArray(data)
    let groupedData = dateList ? Array.from({ length: dateList.length }, (v, i) => ({ x: dateList[i], y: 0 })) : []
    let tempDateList = dateList || []

    dataArray.map((yData, i) => {
        const formattedDate = moment(yData.x).format(format)

        if (tempDateList.includes(formattedDate)) {
            const index = tempDateList.indexOf(formattedDate)
            const item = groupedData[index]
            groupedData[index] = { ...item, y: item.y + yData.y }
        } else {
            tempDateList.push(formattedDate)
            groupedData.push(yData)
        }
    })

    return groupedData
}

export const getDataForOneProjectCharts = (data, momentDate1, momentDate2) => {
    let { format, unit } = getTimeScaleFromDateRange(momentDate1, momentDate2)
    return { data: getDataForCharts(data, format, unit), unit }
}

export const getDataForAllProjectsCharts = (data, momentDate1, momentDate2) => {
    let { format, unit } = getTimeScaleFromDateRange(momentDate1, momentDate2)
    let chartDateLabels = getAllProjectsChartDateLabels(data, format, unit)

    const loggedUserProjects = store.getState().loggedUserProjects

    const amountProjectsByColors = {
        [PROJECT_COLOR_DEFAULT]: 0,
        [PROJECT_COLOR_BLUE]: 0,
        [PROJECT_COLOR_RED]: 0,
        [PROJECT_COLOR_PURPLE]: 0,
        [PROJECT_COLOR_GREEN]: 0,
        [PROJECT_COLOR_PINK]: 0,
        [PROJECT_COLOR_ORANGE]: 0,
        [PROJECT_COLOR_YELLOW]: 0,
        [PROJECT_COLOR_PELOROUS]: 0,
        [PROJECT_COLOR_LIME]: 0,
        [PROJECT_COLOR_VIOLET]: 0,
    }

    const finalData = loggedUserProjects.map(project => {
        let color = project.color
        let amountByColor = amountProjectsByColors[project.color]
        let addition = 0

        if (amountByColor > 0) {
            if (amountByColor > 8) {
                amountByColor = amountByColor % 8
                addition = 5
            }

            if (amountByColor % 2 === 0) {
                color = tinycolor(color).lighten(amountByColor * 10 + addition)
            } else {
                color = tinycolor(color).darken(amountByColor * 10 + addition)
            }
        }
        amountProjectsByColors[project.color]++

        return {
            name: project.name,
            color: color,
            data: getDataForCharts(data[project.id], format, unit, chartDateLabels),
        }
    })

    return { data: finalData, unit }
}

export const getAllProjectsChartDateLabels = (data, format, unit) => {
    let tempDateList = []

    const loggedUserProjects = store.getState().loggedUserProjects

    for (let project of loggedUserProjects) {
        const dataArray = transformObjectToArray(data[project.id])

        dataArray.map((yData, i) => {
            const formattedDate = moment(yData.x).format(format)

            if (!tempDateList.includes(formattedDate)) {
                tempDateList.push(formattedDate)
            }
        })
    }

    return tempDateList
}

export const getTimeScaleFromDateRange = (momentDate1, momentDate2) => {
    const rangeDays = momentDate2.diff(momentDate1, 'days')
    let format = ''
    let unit = ''

    switch (true) {
        case rangeDays <= 31: // Days
            format = 'D MMM YYYY'
            unit = 'day'
            break
        case rangeDays > 31 && rangeDays <= 365: // Months
            format = 'MMM YYYY'
            unit = 'month'
            break
        case rangeDays > 365: // Years
            format = 'YYYY'
            unit = 'year'
            break
    }

    return { format, unit }
}

export const getWeekOfMonthByDate = date => {
    const momentDate = moment(date)
    return Math.ceil(momentDate.date() / 7)
}

export const transformObjectToArray = data => {
    let arr = []

    for (let timestamp in data) {
        // forcing parseInt because sting values may cause unexpected results
        arr.push({ x: parseInt(timestamp), y: parseFloat(data[timestamp]) })
    }

    return arr
}

export const getChartName = selectedChart => {
    switch (selectedChart) {
        case STATISTIC_CHART_DONE_TASKS:
            return 'Done tasks'
        case STATISTIC_CHART_DONE_POINTS:
            return 'Done points'
        case STATISTIC_CHART_DONE_TIME:
            return 'Time logged'
        case STATISTIC_CHART_GOLD:
            return 'Gold points'
        case STATISTIC_CHART_XP:
            return 'XP'
    }
}
