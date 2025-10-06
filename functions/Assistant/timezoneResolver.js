const moment = require('moment')
const { TaskRetrievalService } = require('../shared/TaskRetrievalService')

const MINUTES_IN_HOUR = 60
const MAX_OFFSET_MINUTES = 14 * MINUTES_IN_HOUR
const DST_DELTA_MINUTES = 60

function normalizeTimezoneOffset(value) {
    const normalized = TaskRetrievalService.normalizeTimezoneOffset(value)
    return typeof normalized === 'number' ? normalized : null
}

function parseStartTime(startTime) {
    if (typeof startTime !== 'string') {
        return null
    }
    const parts = startTime.split(':')
    if (parts.length < 2) {
        return null
    }

    const hours = Number(parts[0])
    const minutes = Number(parts[1])

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return null
    }

    return { hours, minutes }
}

function toMomentUtc(value) {
    if (!value) {
        return null
    }

    if (typeof value.toDate === 'function') {
        return moment(value.toDate()).utc()
    }

    if (value instanceof Date) {
        return moment(value).utc()
    }

    if (typeof value === 'number' || typeof value === 'string') {
        const momentValue = moment(value).utc()
        return momentValue.isValid() ? momentValue : null
    }

    return null
}

function deriveOffsetFromStartDate(task) {
    const startDateUtc = toMomentUtc(task?.startDate)
    const startTimeParts = parseStartTime(task?.startTime)

    if (!startDateUtc || !startTimeParts) {
        return null
    }

    const utcMinutes = startDateUtc.hour() * MINUTES_IN_HOUR + startDateUtc.minute()
    const scheduledMinutes = startTimeParts.hours * MINUTES_IN_HOUR + startTimeParts.minutes

    let offsetMinutes = scheduledMinutes - utcMinutes
    offsetMinutes = ((offsetMinutes + 12 * MINUTES_IN_HOUR) % (24 * MINUTES_IN_HOUR)) - 12 * MINUTES_IN_HOUR

    if (offsetMinutes < -MAX_OFFSET_MINUTES || offsetMinutes > MAX_OFFSET_MINUTES) {
        return null
    }

    return offsetMinutes
}

function buildOriginalScheduledMoment({ task, offsetMinutes, startDateUtc, startTimeParts }) {
    if (!task) {
        return null
    }

    const effectiveStartDateUtc = startDateUtc || toMomentUtc(task.startDate)
    const effectiveStartTimeParts = startTimeParts || parseStartTime(task.startTime)

    if (!effectiveStartDateUtc || !effectiveStartTimeParts) {
        return null
    }

    const scheduled = effectiveStartDateUtc.clone().utcOffset(offsetMinutes)
    scheduled.hour(effectiveStartTimeParts.hours).minute(effectiveStartTimeParts.minutes).second(0).millisecond(0)

    return scheduled
}

function convertLastExecutedLocal(lastExecuted, offsetMinutes) {
    const lastExecutedUtc = toMomentUtc(lastExecuted)
    if (!lastExecutedUtc) {
        return null
    }

    return lastExecutedUtc.clone().utcOffset(offsetMinutes)
}

function getCandidateTimezoneOffsets(task, userData = {}) {
    const candidates = []
    const addCandidate = (value, source, priority) => {
        const normalized = normalizeTimezoneOffset(value)
        if (normalized === null) {
            return
        }

        candidates.push({ offsetMinutes: normalized, source, priority })
    }

    addCandidate(task?.userTimezone, 'task.userTimezone', 1)
    addCandidate(task?.userTimezoneOffset, 'task.userTimezoneOffset', 1)
    addCandidate(task?.timezone, 'task.timezone', 1)
    addCandidate(task?.timezoneOffset, 'task.timezoneOffset', 1)
    addCandidate(userData?.timezone, 'user.timezone', 3)
    addCandidate(userData?.timezoneOffset, 'user.timezoneOffset', 3)
    addCandidate(userData?.timezoneMinutes, 'user.timezoneMinutes', 3)
    addCandidate(userData?.preferredTimezone, 'user.preferredTimezone', 4)

    const derivedOffset = deriveOffsetFromStartDate(task)
    if (typeof derivedOffset === 'number') {
        candidates.push({ offsetMinutes: derivedOffset, source: 'derivedFromStartDate', priority: 2 })
    }

    if (!candidates.length) {
        candidates.push({ offsetMinutes: 0, source: 'defaultUTC', priority: 6 })
    }

    const deduped = new Map()
    for (const candidate of candidates) {
        const existing = deduped.get(candidate.offsetMinutes)
        if (!existing) {
            deduped.set(candidate.offsetMinutes, {
                offsetMinutes: candidate.offsetMinutes,
                sources: [candidate.source],
                priority: candidate.priority,
            })
        } else {
            existing.sources.push(candidate.source)
            if (candidate.priority < existing.priority) {
                existing.priority = candidate.priority
            }
        }
    }

    for (const candidate of Array.from(deduped.values())) {
        if (candidate.priority > 3) {
            continue
        }

        for (const delta of [-DST_DELTA_MINUTES, DST_DELTA_MINUTES]) {
            const offsetWithDelta = candidate.offsetMinutes + delta
            if (offsetWithDelta < -MAX_OFFSET_MINUTES || offsetWithDelta > MAX_OFFSET_MINUTES) {
                continue
            }

            if (!deduped.has(offsetWithDelta)) {
                deduped.set(offsetWithDelta, {
                    offsetMinutes: offsetWithDelta,
                    sources: [`${candidate.sources[0]}${delta > 0 ? '+DST' : '-DST'}`],
                    priority: candidate.priority + 2,
                    heuristic: true,
                })
            }
        }
    }

    return Array.from(deduped.values())
}

function evaluateCandidateForSchedule(
    task,
    candidate,
    { nowUtc, startDateUtc, startTimeParts },
    getNextExecutionTimeFn
) {
    const offsetMinutes = candidate.offsetMinutes
    const now = nowUtc.clone().utcOffset(offsetMinutes)
    const originalScheduledTime = buildOriginalScheduledMoment({
        task,
        offsetMinutes,
        startDateUtc,
        startTimeParts,
    })

    if (!originalScheduledTime) {
        return null
    }

    const nowRounded = now.clone().second(0).millisecond(0)
    const originalRounded = originalScheduledTime.clone().second(0).millisecond(0)

    if (!task.lastExecuted) {
        const minutesUntilNextExecution = originalRounded.diff(nowRounded, 'minutes')
        return {
            ...candidate,
            now,
            nowRounded,
            originalScheduledTime,
            originalRounded,
            lastExecutedLocal: null,
            nextExecutionTime: originalScheduledTime.clone(),
            nextExecutionRounded: originalRounded,
            minutesUntilNextExecution,
            shouldExecute: minutesUntilNextExecution <= 0,
            isFirstExecution: true,
        }
    }

    const lastExecutedLocal = convertLastExecutedLocal(task.lastExecuted, offsetMinutes)
    if (!lastExecutedLocal) {
        return null
    }

    const nextExecution = getNextExecutionTimeFn(
        originalScheduledTime.clone(),
        task.recurrence,
        lastExecutedLocal.clone(),
        { suppressLogs: true }
    )
    const nextExecutionRounded = nextExecution.clone().second(0).millisecond(0)
    const minutesUntilNextExecution = nextExecutionRounded.diff(nowRounded, 'minutes')

    return {
        ...candidate,
        now,
        nowRounded,
        originalScheduledTime,
        originalRounded,
        lastExecutedLocal,
        nextExecutionTime: nextExecution,
        nextExecutionRounded,
        minutesUntilNextExecution,
        shouldExecute: minutesUntilNextExecution <= 0,
        isFirstExecution: false,
    }
}

function selectBestEvaluation(evaluations) {
    if (!evaluations.length) {
        return null
    }

    const ready = evaluations.filter(evaluation => evaluation.shouldExecute)
    if (ready.length > 0) {
        return ready.sort((a, b) => {
            const diff = b.minutesUntilNextExecution - a.minutesUntilNextExecution
            if (diff !== 0) {
                return diff
            }
            return a.priority - b.priority
        })[0]
    }

    return evaluations.sort((a, b) => {
        const diff = a.minutesUntilNextExecution - b.minutesUntilNextExecution
        if (diff !== 0) {
            return diff
        }
        return a.priority - b.priority
    })[0]
}

function resolveTimezoneContext(task, userData = {}, options = {}, getNextExecutionTimeFn) {
    if (typeof getNextExecutionTimeFn !== 'function') {
        throw new Error('getNextExecutionTimeFn is required for resolveTimezoneContext')
    }

    const nowUtc = options.nowUtc ? moment(options.nowUtc).utc() : moment.utc()
    const startDateUtc = toMomentUtc(task?.startDate)
    const startTimeParts = parseStartTime(task?.startTime)

    const candidates = getCandidateTimezoneOffsets(task, userData)
    const evaluations = candidates
        .map(candidate =>
            evaluateCandidateForSchedule(
                task,
                candidate,
                { nowUtc, startDateUtc, startTimeParts },
                getNextExecutionTimeFn
            )
        )
        .filter(Boolean)

    const selectedEvaluation = selectBestEvaluation(evaluations)

    return {
        candidates,
        evaluations,
        selectedEvaluation,
        effectiveOffsetMinutes:
            selectedEvaluation?.offsetMinutes ?? (candidates.length > 0 ? candidates[0].offsetMinutes : 0),
    }
}

module.exports = {
    MINUTES_IN_HOUR,
    resolveTimezoneContext,
    buildOriginalScheduledMoment,
    normalizeTimezoneOffset,
    parseStartTime,
    toMomentUtc,
}
