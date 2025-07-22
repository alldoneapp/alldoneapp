import moment from 'moment'

import { getEstimationToUse, getRoundedStartAndEndDates, roundDate } from './myDayOpenTasksHelper'
import { orderBy } from 'lodash'
import { getTaskAutoEstimation } from '../../../TaskListView/Utils/TasksHelper'

const splitTasksInCalendarAndNotCalendar = tasks => {
    const calendarTasks = []
    const nonCalendarTasks = []

    tasks.forEach(task => {
        task.calendarData ? calendarTasks.push(task) : nonCalendarTasks.push(task)
    })

    return { calendarTasks, nonCalendarTasks }
}

const sortCalendarTasks = (calendarTasks, firstLoginDateInDay) => {
    const ALL_DAY_EVENT_DURATION_IN_HOURS = 8
    const endTimeForAllDayCalendarTasks = moment(firstLoginDateInDay)
        .add(ALL_DAY_EVENT_DURATION_IN_HOURS, 'hours')
        .valueOf()

    const sortedCalendarTasks = orderBy(
        calendarTasks,
        [
            task => {
                const { start } = task.calendarData
                const startDateTimestamp = start.dateTime ? moment(start.dateTime).valueOf() : firstLoginDateInDay
                return startDateTimestamp
            },
            task => {
                const { end } = task.calendarData
                const endDateTimestamp = end.dateTime ? moment(end.dateTime).valueOf() : endTimeForAllDayCalendarTasks
                return endDateTimestamp
            },
            task => task.sortIndex,
        ],
        ['asc', 'asc', 'desc']
    )

    return sortedCalendarTasks
}

export const getCalendarTaskStartAndEndTimestamp = (calendarData, firstLoginDateInDay) => {
    const { start, end } = calendarData

    let startDateTimestamp
    let endDateTimestamp

    if (start.dateTime && end.dateTime) {
        startDateTimestamp = moment(start.dateTime).valueOf()
        endDateTimestamp = moment(end.dateTime).valueOf()
    } else {
        const estimationForAllDayCalendarTasks = 480
        const { startDate, endDate } = getRoundedStartAndEndDates(firstLoginDateInDay, estimationForAllDayCalendarTasks)
        startDateTimestamp = startDate
        endDateTimestamp = endDate
    }

    return { startDateTimestamp, endDateTimestamp }
}

const generateCalendarIntervals = (sortedCalendarTasks, firstLoginDateInDay) => {
    const timeIntervals = []

    sortedCalendarTasks.forEach(task => {
        const { startDateTimestamp, endDateTimestamp } = getCalendarTaskStartAndEndTimestamp(
            task.calendarData,
            firstLoginDateInDay
        )

        timeIntervals.push({
            startTime: startDateTimestamp,
            endTime: endDateTimestamp,
            task,
        })
    })

    return timeIntervals
}

const generateFreeIntervals = (calendarTimeIntervals, activeTaskStartingDate) => {
    let starIntervalTime = activeTaskStartingDate
    let firstIntervalIsFree = true

    if (calendarTimeIntervals.length > 0) {
        const currentTime = roundDate(moment().valueOf())
        const firstCalendarIntervale = calendarTimeIntervals[calendarTimeIntervals.length - 1]
        if (firstCalendarIntervale.startTime <= currentTime) {
            starIntervalTime = currentTime
            firstIntervalIsFree = false
        }
    }

    const freeIntervals = []
    calendarTimeIntervals.forEach(interval => {
        const { startTime, endTime } = interval

        if (starIntervalTime < startTime) {
            freeIntervals.push({
                startTime: starIntervalTime,
                endTime: startTime,
            })
        }
        if (endTime > starIntervalTime) starIntervalTime = endTime
    })

    freeIntervals.push({ startTime: starIntervalTime, endTime: moment().add(10000, 'years').valueOf() })

    return { freeIntervals, firstIntervalIsFree }
}

const roundTimeToNextHalfHour = time => {
    const startOfHour = moment(time).startOf('hour')
    const startOfHourDifference = Math.abs(startOfHour.diff(moment(time), 'minutes'))

    if (startOfHourDifference === 0) {
        return startOfHour
    } else if (startOfHourDifference <= 15) {
        return moment(time).startOf('hour').add(15, 'minutes')
    } else if (startOfHourDifference <= 30) {
        return moment(time).startOf('hour').add(30, 'minutes')
    } else if (startOfHourDifference <= 45) {
        return moment(time).startOf('hour').add(45, 'minutes')
    } else {
        return moment(time).startOf('hour').add(1, 'hour')
    }
}

const groupNonCalendarTaskByProject = (nonCalendarTasks, user, loggedUserProjectsMap) => {
    const { guideProjectIds } = user

    const sortedNonCalendarTasks = orderBy(
        nonCalendarTasks,
        [
            task => task.projectId === user.inFocusTaskProjectId,
            task => guideProjectIds.includes(task.projectId),
            task => loggedUserProjectsMap[task.projectId].sortIndexByUser[user.uid],
            task => loggedUserProjectsMap[task.projectId].name.toLowerCase(),
        ],
        ['desc', 'asc', 'desc', 'asc']
    )

    return sortedNonCalendarTasks
}

const groupNonCalendarTaskByProjectForSortingMode = (nonCalendarTasks, user, loggedUserProjectsMap) => {
    const sortedNonCalendarTasks = orderBy(
        nonCalendarTasks,
        [
            task => loggedUserProjectsMap[task.projectId].sortIndexByUser[user.uid],
            task => loggedUserProjectsMap[task.projectId].name.toLowerCase(),
        ],
        ['desc', 'asc']
    )

    return sortedNonCalendarTasks
}

const generateNonCalendarTaskIntervals = (
    freeIntervals,
    nonCalendarTasks,
    user,
    firstIntervalIsFree,
    loggedUserProjectsMap
) => {
    const timeIntervals = []

    let tempFreeIntervals = [...freeIntervals]
    nonCalendarTasks.forEach((task, index) => {
        const { estimation } = getEstimationToUse(task, user.uid)
        for (let i = 0; i < tempFreeIntervals.length; i++) {
            const { startTime, endTime } = tempFreeIntervals[i]

            const isFirstTaskAndFirstIntervaleAndIntervaleIsFree = firstIntervalIsFree && index === 0 && i === 0
            const roundedIntervalStarDate = isFirstTaskAndFirstIntervaleAndIntervaleIsFree
                ? moment(startTime)
                : roundTimeToNextHalfHour(startTime)

            let { startDate, endDate } = getRoundedStartAndEndDates(roundedIntervalStarDate, estimation)

            if (isFirstTaskAndFirstIntervaleAndIntervaleIsFree && task.id === user.activeTaskId) {
                const canExtendEstimation = getTaskAutoEstimation(
                    user.activeTaskProjectId,
                    estimation,
                    task.autoEstimation,
                    loggedUserProjectsMap
                )
                if (!canExtendEstimation) {
                    const { startDate: updatedStartDate, endDate: updatedEndDate } = getRoundedStartAndEndDates(
                        moment(),
                        estimation
                    )
                    startDate = updatedStartDate
                    endDate = updatedEndDate
                }
            }

            if (
                (isFirstTaskAndFirstIntervaleAndIntervaleIsFree || startTime <= startDate.valueOf()) &&
                endTime >= endDate.valueOf()
            ) {
                timeIntervals.push({
                    startTime: startDate.valueOf(),
                    endTime: endDate.valueOf(),
                    task,
                })

                tempFreeIntervals =
                    endDate.valueOf() === endTime
                        ? tempFreeIntervals.slice(i + 1)
                        : [{ startTime: endDate.valueOf(), endTime }, ...tempFreeIntervals.slice(i + 1)]

                break
            }
        }
    })

    return timeIntervals
}

const blendTasksIntervals = (calendarTimeIntervals, nonCalendarTaskIntervals) => {
    const timeIntervals = orderBy(
        [...calendarTimeIntervals, ...nonCalendarTaskIntervals],
        [intervale => intervale.startTime, intervale => intervale.endTime, intervale => intervale.task.sortIndex],
        ['asc', 'asc', 'desc']
    )

    return timeIntervals
}

const convertIntervalsToTasks = timeIntervals => {
    const selectedTasks = []
    const otherTasks = []

    const todayDateFormated = moment().format('YYYYMMDD')

    timeIntervals.forEach(interval => {
        const { startTime, endTime, task } = interval
        const startDate = moment(startTime)
        const endDate = moment(endTime)
        const newTask = {
            ...task,
            time: { startDate, endDate },
            estimatedDateFormated: startDate.format('YYYYMMDD'),
        }
        newTask.estimatedDateFormated === todayDateFormated ? selectedTasks.push(newTask) : otherTasks.push(newTask)
    })
    return { selectedTasks, otherTasks }
}

export const sortTaskByTimeForSortingMode = (tasks, user, loggedUserProjectsMap) => {
    const { guideProjectIds } = user

    const { nonCalendarTasks } = splitTasksInCalendarAndNotCalendar(tasks)
    const { freeIntervals } = generateFreeIntervals([], user.activeTaskStartingDate)

    const tasksFromActiveProjects = nonCalendarTasks.filter(task => !guideProjectIds.includes(task.projectId))

    const sortedNonCalendarTasks = groupNonCalendarTaskByProjectForSortingMode(
        tasksFromActiveProjects,
        user,
        loggedUserProjectsMap
    )

    const nonCalendarTaskIntervals = generateNonCalendarTaskIntervals(
        freeIntervals,
        sortedNonCalendarTasks,
        user,
        true,
        loggedUserProjectsMap
    )
    const timeIntervals = blendTasksIntervals([], nonCalendarTaskIntervals)
    const { selectedTasks, otherTasks } = convertIntervalsToTasks(timeIntervals)

    return { selectedTasks, otherTasks }
}

export const sortTaskByTime = (tasks, user, loggedUserProjectsMap) => {
    const { calendarTasks, nonCalendarTasks } = splitTasksInCalendarAndNotCalendar(tasks)
    const sortedCalendarTasks = sortCalendarTasks(calendarTasks, user.firstLoginDateInDay)
    const calendarTimeIntervals = generateCalendarIntervals(sortedCalendarTasks, user.firstLoginDateInDay)
    const { freeIntervals, firstIntervalIsFree } = generateFreeIntervals(
        calendarTimeIntervals,
        user.activeTaskStartingDate
    )

    const sortedNonCalendarTasks = groupNonCalendarTaskByProject(nonCalendarTasks, user, loggedUserProjectsMap)

    const nonCalendarTaskIntervals = generateNonCalendarTaskIntervals(
        freeIntervals,
        sortedNonCalendarTasks,
        user,
        firstIntervalIsFree,
        loggedUserProjectsMap
    )
    const timeIntervals = blendTasksIntervals(calendarTimeIntervals, nonCalendarTaskIntervals)
    const { selectedTasks, otherTasks } = convertIntervalsToTasks(timeIntervals)

    return { selectedTasks, otherTasks }
}
