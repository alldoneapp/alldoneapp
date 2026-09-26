'use strict'

const moment = require('moment-timezone')

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly']

function eventStartDate(start, timeZone) {
    const value = typeof start === 'string' ? start : start?.date || start?.dateTime
    if (!value) throw new Error('A start date is required for recurrence.')
    const zone = [start?.timeZone, timeZone].find(
        candidate => typeof candidate === 'string' && moment.tz.zone(candidate)
    )
    if (typeof zone === 'string' && moment.tz.zone(zone)) {
        const date = moment.tz(value, zone)
        if (!date.isValid()) throw new Error('Invalid recurrence start date.')
        return { date: date.format('YYYY-MM-DD'), day: date.day(), zone }
    }
    const date = moment.parseZone(value, moment.ISO_8601, true)
    if (!date.isValid()) throw new Error('Invalid recurrence start date.')
    return { date: date.format('YYYY-MM-DD'), day: date.day(), zone: '' }
}

function validateRecurrence(recurrence, start, timeZone) {
    if (!recurrence || typeof recurrence !== 'object' || Array.isArray(recurrence)) {
        throw new Error('recurrence must be a structured schedule.')
    }
    const allowed = ['frequency', 'interval', 'daysOfWeek', 'endDate', 'count']
    const unknown = Object.keys(recurrence).filter(key => !allowed.includes(key))
    if (unknown.length) throw new Error(`Unsupported recurrence fields: ${unknown.join(', ')}.`)
    const { frequency, interval = 1, daysOfWeek, endDate, count } = recurrence
    if (!FREQUENCIES.includes(frequency))
        throw new Error('recurrence.frequency must be daily, weekly, monthly, or yearly.')
    if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
        throw new Error('recurrence.interval must be an integer from 1 to 999.')
    }
    if (endDate !== undefined && count !== undefined) {
        throw new Error('Use either recurrence.endDate or recurrence.count, not both.')
    }
    if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 9999)) {
        throw new Error('recurrence.count must be an integer from 1 to 9999.')
    }
    const first = eventStartDate(start, timeZone)
    if (!(typeof start === 'object' && start?.date) && !first.zone) {
        throw new Error(
            'Recurring timed events require an IANA timeZone to preserve the local time across daylight saving changes.'
        )
    }
    if ((frequency === 'monthly' || frequency === 'yearly') && Number(first.date.slice(8, 10)) > 28) {
        throw new Error(
            'Monthly and yearly recurrence starting after day 28 is not supported consistently across calendar providers.'
        )
    }
    if (endDate !== undefined) {
        if (
            typeof endDate !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
            !moment(endDate, 'YYYY-MM-DD', true).isValid()
        ) {
            throw new Error('recurrence.endDate must be a valid YYYY-MM-DD date.')
        }
        if (endDate < first.date) throw new Error('recurrence.endDate must be on or after the first event date.')
    }
    if (daysOfWeek !== undefined) {
        if (
            frequency !== 'weekly' ||
            !Array.isArray(daysOfWeek) ||
            !daysOfWeek.length ||
            new Set(daysOfWeek).size !== daysOfWeek.length ||
            daysOfWeek.some(day => !DAYS.includes(day))
        ) {
            throw new Error(
                'recurrence.daysOfWeek must contain distinct weekdays and is supported only for weekly recurrence.'
            )
        }
        if (!daysOfWeek.includes(DAYS[first.day])) {
            throw new Error('recurrence.daysOfWeek must include the first event weekday.')
        }
    }
    return { frequency, interval, daysOfWeek: daysOfWeek || [DAYS[first.day]], endDate, count, first }
}

function toGoogleRecurrence(recurrence, start, timeZone) {
    const rule = validateRecurrence(recurrence, start, timeZone)
    const parts = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${rule.interval}`]
    if (rule.frequency === 'weekly') {
        parts.push(`BYDAY=${rule.daysOfWeek.map(day => RRULE_DAYS[DAYS.indexOf(day)]).join(',')}`)
    }
    if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`)
    if (rule.endDate !== undefined) {
        // Google Calendar expects a UTC UNTIL for timed events. End dates are inclusive in the event timezone.
        if (typeof start === 'object' && start?.date) {
            parts.push(`UNTIL=${rule.endDate.replace(/-/g, '')}`)
        } else {
            const until = moment.tz(`${rule.endDate} 23:59:59`, 'YYYY-MM-DD HH:mm:ss', rule.first.zone).utc()
            parts.push(`UNTIL=${until.format('YYYYMMDDTHHmmss[Z]')}`)
        }
    }
    return [`RRULE:${parts.join(';')}`]
}

function toMicrosoftRecurrence(recurrence, start, timeZone) {
    const rule = validateRecurrence(recurrence, start, timeZone)
    const pattern = { type: rule.frequency, interval: rule.interval }
    if (rule.frequency === 'weekly') {
        pattern.daysOfWeek = rule.daysOfWeek
        pattern.firstDayOfWeek = 'monday'
    } else if (rule.frequency === 'monthly') {
        pattern.type = 'absoluteMonthly'
        pattern.dayOfMonth = Number(rule.first.date.slice(8, 10))
    } else if (rule.frequency === 'yearly') {
        pattern.type = 'absoluteYearly'
        pattern.dayOfMonth = Number(rule.first.date.slice(8, 10))
        pattern.month = Number(rule.first.date.slice(5, 7))
    }
    const range = {
        type: rule.count !== undefined ? 'numbered' : rule.endDate ? 'endDate' : 'noEnd',
        startDate: rule.first.date,
    }
    if (rule.count !== undefined) range.numberOfOccurrences = rule.count
    if (rule.endDate) range.endDate = rule.endDate
    if (rule.first.zone) range.recurrenceTimeZone = rule.first.zone
    return { pattern, range }
}

function validateScope(scope) {
    if (scope !== undefined && scope !== 'occurrence' && scope !== 'series') {
        throw new Error('scope must be occurrence or series.')
    }
}

function resolveRecurringTarget(event, eventId, scope, provider) {
    validateScope(scope)
    const seriesId = provider === 'google' ? event?.recurringEventId : event?.seriesMasterId
    const isMaster =
        provider === 'google'
            ? Array.isArray(event?.recurrence) && event.recurrence.length > 0
            : event?.type === 'seriesMaster'
    if ((seriesId || isMaster) && !scope) {
        return {
            error: {
                success: false,
                code: 'calendar_recurrence_scope_required',
                message: 'Specify scope: occurrence or series for this recurring event.',
            },
        }
    }
    if (scope === 'occurrence' && isMaster) {
        return {
            error: {
                success: false,
                code: 'calendar_occurrence_id_required',
                message: 'Provide an occurrence eventId to change only one occurrence.',
            },
        }
    }
    if (scope === 'series' && !seriesId && !isMaster) {
        return {
            error: {
                success: false,
                code: 'calendar_not_recurring',
                message: 'This event is not part of a recurring series.',
            },
        }
    }
    return { eventId: scope === 'series' ? seriesId || eventId : eventId }
}

module.exports = {
    validateRecurrence,
    toGoogleRecurrence,
    toMicrosoftRecurrence,
    validateScope,
    resolveRecurringTarget,
}
