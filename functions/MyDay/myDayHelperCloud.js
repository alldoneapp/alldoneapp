const moment = require('moment')
const { OPEN_STEP } = require('../Utils/HelperFunctionsCloud')

const getEstimationToUse = (task, userId) => {
    const {
        stepHistory,
        estimations,
        estimationsByObserverIds,
        dueDateByObserversIds,
        userIds,
        currentReviewerId,
        inDone,
        dueDate,
    } = task

    const endOfDayUtc = moment().endOf('day').utc().format('YYYY-MM-DD HH:mm:ss')
    const endOfDayUtcValue = moment(endOfDayUtc, 'YYYY-MM-DD HH:mm:ss').valueOf()

    const isObservedTask = dueDateByObserversIds[userId] <= endOfDayUtcValue && !inDone
    const isToReviewTask = userIds.length > 1 && currentReviewerId === userId && dueDate <= endOfDayUtcValue && !inDone
    const isPending = userIds.length > 1 && currentReviewerId !== userId && dueDate <= endOfDayUtcValue && !inDone

    if (inDone) {
        return { estimation: estimations[OPEN_STEP] || 0, inDone }
    } else if (isPending) {
        return { estimation: estimations[OPEN_STEP] || 0, isPending }
    } else if (isObservedTask && !isToReviewTask) {
        return { estimation: estimationsByObserverIds[userId] || 0, isObservedTask }
    } else {
        const currentStepId = stepHistory[stepHistory.length - 1]
        return { estimation: estimations[currentStepId] || 0, currentStepId, isToReviewTask }
    }
}

const getRoundedStartAndEndDateValues = (activeTaskStartingDate, estimation) => {
    const MIN_ESTIMATION = 15

    const startDate = roundDate(activeTaskStartingDate)

    const baseEndDate = moment(startDate).add(estimation > MIN_ESTIMATION ? estimation : MIN_ESTIMATION, 'minutes')
    const endDate = roundDate(baseEndDate)

    const startDateUtc = startDate.format('YYYY-MM-DD HH:mm:ss')
    const startDateUtcValue = moment(startDateUtc, 'YYYY-MM-DD HH:mm:ss').valueOf()

    const endDateUtc = endDate.format('YYYY-MM-DD HH:mm:ss')
    const endDateUtcValue = moment(endDateUtc, 'YYYY-MM-DD HH:mm:ss').valueOf()

    return { startDateUtcValue, endDateUtcValue }
}

const roundDate = date => {
    const baseDate = moment(date)

    const startOfHour = moment(date).startOf('hour')
    const quarterOfHour = moment(date).startOf('hour').add(15, 'minutes')
    const middleOfHour = moment(date).startOf('hour').add(30, 'minutes')
    const quarterToHour = moment(date).startOf('hour').add(45, 'minutes')
    const endOfHour = moment(date).startOf('hour').add(1, 'hour')

    const startOfHourDifference = Math.abs(startOfHour.diff(baseDate, 'minutes'))
    const quarterOfHourDifference = Math.abs(quarterOfHour.diff(baseDate, 'minutes'))
    const middleOfHourDifference = Math.abs(middleOfHour.diff(baseDate, 'minutes'))
    const quarterToHourDifference = Math.abs(quarterToHour.diff(baseDate, 'minutes'))
    const endOfHourDifference = Math.abs(endOfHour.diff(baseDate, 'minutes'))

    let roundedDate

    const CLOSE_MINUTES_BOUNDRY = 5

    if (startOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = startOfHour
    } else if (quarterOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = quarterOfHour
    } else if (middleOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = middleOfHour
    } else if (quarterToHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = quarterToHour
    } else if (endOfHourDifference <= CLOSE_MINUTES_BOUNDRY) {
        roundedDate = endOfHour
    } else if (baseDate.isBefore(quarterOfHour)) {
        roundedDate = quarterOfHour
    } else if (baseDate.isBefore(middleOfHour)) {
        roundedDate = middleOfHour
    } else if (baseDate.isBefore(quarterToHour)) {
        roundedDate = quarterToHour
    } else {
        roundedDate = endOfHour
    }

    return roundedDate
}

const getActiveTaskRoundedStartAndEndDates = (task, userId, activeTaskStartingDate) => {
    const { estimation } = getEstimationToUse(task, userId)

    const dateUtc = moment(activeTaskStartingDate).utc().format('YYYY-MM-DD HH:mm:ss')

    const { startDateUtcValue, endDateUtcValue } = getRoundedStartAndEndDateValues(
        moment(dateUtc, 'YYYY-MM-DD HH:mm:ss'),
        estimation
    )

    return { startDateUtcValue, endDateUtcValue }
}

module.exports = {
    getActiveTaskRoundedStartAndEndDates,
}
