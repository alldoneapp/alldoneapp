'use strict'

const admin = require('firebase-admin')
const { google } = require('googleapis')
const moment = require('moment-timezone')

const { getAuthorizedOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')
const { extractMeetingJoinUrl } = require('../Calendar/meetingJoinUrl')
const {
    GOOGLE_CONFERENCE_DATA_VERSION,
    buildGoogleMeetCreateRequest,
    googleConferenceSucceeded,
    isConferencingRejection,
    shouldAddConferencing,
} = require('../Calendar/conferencing')
const {
    dayKeepsMinimumFreeTime,
    getMinFreeHoursPerDayForUser,
    minFreeHoursToMinutes,
    normalizeMinFreeHoursPerDay,
    sumBusyMinutesInWindow,
} = require('../Calendar/dailyFreeTime')
const {
    createMicrosoftCalendarEventForAssistantRequest,
    deleteMicrosoftCalendarEventForAssistantRequest,
    getMicrosoftCalendarBusyIntervalsForAssistantRequest,
    getConnectedMicrosoftCalendarAccounts,
    searchMicrosoftCalendarEventsForAssistantRequest,
    updateMicrosoftCalendarEventForAssistantRequest,
} = require('../Calendar/providers/microsoftCalendarProvider')

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20
const DEFAULT_CALENDAR_ID = 'primary'
const DEFAULT_AVAILABILITY_DURATION_MINUTES = 30
const DEFAULT_AVAILABILITY_MAX_OPTIONS = 3
const MAX_AVAILABILITY_OPTIONS = 96
const DEFAULT_AVAILABILITY_SLOT_INTERVAL_MINUTES = 30
const MAX_AVAILABILITY_RANGE_DAYS = 31
const MAX_AVAILABILITY_PAGES_PER_CALENDAR = 100
const DEFAULT_WORKING_HOURS_START = '09:00'
const DEFAULT_WORKING_HOURS_END = '17:00'
const PUBLIC_MEETING_LINK_SETTINGS_PATH = userId => `users/${userId}/bookingSettings/default`

function getActiveProjectIds(userData = {}) {
    const projectIds = Array.isArray(userData.projectIds) ? userData.projectIds : []
    const archivedProjectIds = Array.isArray(userData.archivedProjectIds) ? userData.archivedProjectIds : []
    const templateProjectIds = Array.isArray(userData.templateProjectIds) ? userData.templateProjectIds : []
    const guideProjectIds = Array.isArray(userData.guideProjectIds) ? userData.guideProjectIds : []
    const blockedProjectIds = new Set([...archivedProjectIds, ...templateProjectIds, ...guideProjectIds])

    const activeProjectIds = projectIds.filter(projectId => !blockedProjectIds.has(projectId))
    const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId.trim() : ''
    if (defaultProjectId && !blockedProjectIds.has(defaultProjectId) && !activeProjectIds.includes(defaultProjectId)) {
        activeProjectIds.unshift(defaultProjectId)
    }

    return activeProjectIds
}

function normalizeLimit(limit) {
    const parsed = parseInt(limit, 10)
    if (!Number.isFinite(parsed)) return DEFAULT_SEARCH_LIMIT
    return Math.min(Math.max(parsed, 1), MAX_SEARCH_LIMIT)
}

async function settleAll(promises) {
    return Promise.all(
        promises.map(promise =>
            Promise.resolve(promise)
                .then(value => ({ status: 'fulfilled', value }))
                .catch(reason => ({ status: 'rejected', reason }))
        )
    )
}

function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizeCalendarId(calendarId) {
    const trimmed = safeTrim(calendarId)
    return trimmed || DEFAULT_CALENDAR_ID
}

function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isValidIsoDateTime(value) {
    if (typeof value !== 'string' || !value.trim()) return false
    return moment.parseZone(value, moment.ISO_8601, true).isValid()
}

function hasExplicitDateTimeTimezone(value) {
    if (typeof value !== 'string') return false
    return /([zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim())
}

function resolveUserIanaTimeZone(userData = {}) {
    const candidates = [
        userData?.timezone,
        userData?.preferredTimezone,
        userData?.timezoneOffset,
        userData?.timezoneMinutes,
    ]

    for (const candidate of candidates) {
        const trimmed = safeTrim(candidate)
        if (trimmed && moment.tz.zone(trimmed)) {
            return trimmed
        }
    }

    return ''
}

function normalizeAttendees(attendees) {
    if (!Array.isArray(attendees)) return []

    return attendees
        .map(attendee => {
            if (typeof attendee === 'string') {
                const email = attendee.trim()
                return email ? { email } : null
            }

            if (!attendee || typeof attendee !== 'object') return null

            const email = safeTrim(attendee.email)
            if (!email) return null

            const normalized = { email }
            const displayName = safeTrim(attendee.displayName)
            const optionalFields = ['optional', 'resource']
            if (displayName) normalized.displayName = displayName
            optionalFields.forEach(field => {
                if (typeof attendee[field] === 'boolean') normalized[field] = attendee[field]
            })
            const responseStatus = safeTrim(attendee.responseStatus)
            if (responseStatus) normalized.responseStatus = responseStatus
            return normalized
        })
        .filter(Boolean)
}

function normalizeEventDateTimeInput(value, fallbackTimeZone) {
    if (!value) return null

    if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return null

        if (isIsoDate(trimmed)) {
            return { date: trimmed }
        }

        if (!isValidIsoDateTime(trimmed)) {
            throw new Error(`Invalid event time "${trimmed}". Use ISO 8601 strings only.`)
        }

        if (!hasExplicitDateTimeTimezone(trimmed) && !fallbackTimeZone) {
            throw new Error(
                `Timed event "${trimmed}" is missing timezone information. Provide an offset like +02:00 or an IANA timeZone such as "Europe/Berlin".`
            )
        }

        const normalized = { dateTime: trimmed }
        if (fallbackTimeZone) normalized.timeZone = fallbackTimeZone
        return normalized
    }

    if (typeof value !== 'object') {
        throw new Error('Invalid event time. Use an ISO 8601 string or a Calendar date/dateTime object.')
    }

    if (value.date !== undefined) {
        const date = safeTrim(value.date)
        if (!isIsoDate(date)) throw new Error(`Invalid all-day event date "${date}". Use YYYY-MM-DD.`)
        return { date }
    }

    if (value.dateTime !== undefined) {
        const dateTime = safeTrim(value.dateTime)
        if (!isValidIsoDateTime(dateTime)) {
            throw new Error(`Invalid event time "${dateTime}". Use ISO 8601 strings only.`)
        }

        const normalized = { dateTime }
        const timeZone = safeTrim(value.timeZone) || fallbackTimeZone
        if (!hasExplicitDateTimeTimezone(dateTime) && !timeZone) {
            throw new Error(
                `Timed event "${dateTime}" is missing timezone information. Provide an offset like +02:00 or an IANA timeZone such as "Europe/Berlin".`
            )
        }
        if (timeZone) normalized.timeZone = timeZone
        return normalized
    }

    throw new Error('Invalid event time object. Expected {date} or {dateTime, timeZone}.')
}

function validateEventRange(start, end) {
    if (!start || !end) throw new Error('Both start and end times are required.')

    const isAllDay = Boolean(start.date || end.date)
    if (isAllDay) {
        if (!start.date || !end.date) {
            throw new Error('All-day events must provide start.date and end.date.')
        }
        if (start.date >= end.date) {
            throw new Error('Event end must be after event start.')
        }
        return
    }

    if (!start.dateTime || !end.dateTime) {
        throw new Error('Timed events must provide start.dateTime and end.dateTime.')
    }

    const startMoment = moment.parseZone(start.dateTime)
    const endMoment = moment.parseZone(end.dateTime)
    if (!startMoment.isValid() || !endMoment.isValid() || !endMoment.isAfter(startMoment)) {
        throw new Error('Event end must be after event start.')
    }
}

async function getCalendarClient(userId, projectId) {
    // Full refreshable credentials, not a bare access token (AT-2195).
    const auth = await getAuthorizedOAuth2Client(userId, projectId, 'calendar')
    return google.calendar({ version: 'v3', auth })
}

async function getConnectedCalendarAccounts(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) throw new Error('User not found')

    const userData = userDoc.data() || {}
    const apisConnected = userData.apisConnected || {}
    const activeProjectIds = getActiveProjectIds(userData)
    const seenKeys = new Set()
    const accounts = []

    activeProjectIds.forEach(projectId => {
        const connection = apisConnected?.[projectId]
        if (!connection?.calendar) return
        if (connection.calendarProvider === 'microsoft') return

        const calendarEmail =
            typeof connection.calendarEmail === 'string' ? connection.calendarEmail.trim().toLowerCase() : ''
        const dedupeKey = calendarEmail || projectId
        if (seenKeys.has(dedupeKey)) return
        seenKeys.add(dedupeKey)

        accounts.push({
            projectId,
            calendarEmail: calendarEmail || null,
            calendarDefault: connection.calendarDefault === true,
        })
    })

    return accounts
}

async function getUserDefaultTimeZone(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) return ''

    return resolveUserIanaTimeZone(userDoc.data() || {})
}

async function getPublicMeetingLinkSettings(userId) {
    if (!userId) return { exists: false, settings: null }

    try {
        const snapshot = await admin.firestore().doc(PUBLIC_MEETING_LINK_SETTINGS_PATH(userId)).get()
        if (!snapshot?.exists) return { exists: false, settings: null }
        return {
            exists: true,
            settings: (typeof snapshot.data === 'function' ? snapshot.data() : null) || {},
        }
    } catch (error) {
        console.warn('📅 PUBLIC_MEETING_LINK_SETTINGS: failed to load availability policy', {
            userId,
            error: error?.message,
        })
        return { exists: false, settings: null, error }
    }
}

function normalizeBoundedInteger(value, fallback, min, max) {
    const parsed = parseInt(value, 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(Math.max(parsed, min), max)
}

function normalizeClockTime(value, fallback) {
    const normalized = safeTrim(value) || fallback
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
        throw new Error(`Invalid working-hours time "${normalized}". Use HH:mm in 24-hour format.`)
    }
    return normalized
}

function parseAvailabilityBoundary(value, timeZone, label) {
    const normalized = safeTrim(value)
    if (!normalized) throw new Error(`${label} is required.`)

    const parsed = hasExplicitDateTimeTimezone(normalized)
        ? moment.parseZone(normalized)
        : moment.tz(normalized, timeZone)
    if (!parsed.isValid()) throw new Error(`${label} must be a valid ISO 8601 date-time.`)
    return parsed
}

function parseGoogleEventBoundary(value = {}, timeZone) {
    if (safeTrim(value.dateTime)) {
        const dateTime = safeTrim(value.dateTime)
        const parsed = hasExplicitDateTimeTimezone(dateTime)
            ? moment.parseZone(dateTime)
            : moment.tz(dateTime, safeTrim(value.timeZone) || timeZone)
        return parsed.isValid() ? parsed.valueOf() : null
    }

    if (safeTrim(value.date)) {
        const parsed = moment.tz(safeTrim(value.date), timeZone)
        return parsed.isValid() ? parsed.valueOf() : null
    }

    return null
}

function isGoogleAllDayOrMultiDayEvent(event) {
    if (safeTrim(event?.start?.date) || safeTrim(event?.end?.date)) return true

    const startDateTime = safeTrim(event?.start?.dateTime)
    const endDateTime = safeTrim(event?.end?.dateTime)
    if (!startDateTime || !endDateTime) return false

    const startDate = startDateTime.substring(0, 10)
    const endDate = endDateTime.substring(0, 10)
    return isIsoDate(startDate) && isIsoDate(endDate) && startDate !== endDate
}

function normalizeGoogleBusyInterval(event, timeZone) {
    if (
        event?.status === 'cancelled' ||
        event?.transparency === 'transparent' ||
        isGoogleAllDayOrMultiDayEvent(event)
    ) {
        return null
    }

    const startMs = parseGoogleEventBoundary(event?.start, timeZone)
    const endMs = parseGoogleEventBoundary(event?.end, timeZone)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw new Error('Google Calendar returned invalid busy-event timing.')
    }
    return { startMs, endMs }
}

function mergeBusyIntervals(intervals = [], rangeStartMs, rangeEndMs) {
    const normalized = intervals
        .map(interval => ({
            startMs: Math.max(Number(interval?.startMs), rangeStartMs),
            endMs: Math.min(Number(interval?.endMs), rangeEndMs),
        }))
        .filter(interval => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs))
        .filter(interval => interval.endMs > interval.startMs)
        .sort((a, b) => a.startMs - b.startMs)

    const merged = []
    normalized.forEach(interval => {
        const previous = merged[merged.length - 1]
        if (!previous || interval.startMs > previous.endMs) {
            merged.push({ ...interval })
            return
        }
        previous.endMs = Math.max(previous.endMs, interval.endMs)
    })
    return merged
}

function applyBusyIntervalBuffers(intervals = [], bufferBeforeMinutes = 0, bufferAfterMinutes = 0) {
    const beforeMs = Math.max(parseInt(bufferBeforeMinutes, 10) || 0, 0) * 60 * 1000
    const afterMs = Math.max(parseInt(bufferAfterMinutes, 10) || 0, 0) * 60 * 1000

    return intervals.map(interval => ({
        startMs: Number(interval?.startMs) - beforeMs,
        endMs: Number(interval?.endMs) + afterMs,
    }))
}

function ceilMomentToInterval(value, anchor, intervalMinutes) {
    const elapsedMinutes = value.diff(anchor, 'minutes', true)
    return anchor.clone().add(Math.ceil(Math.max(elapsedMinutes, 0) / intervalMinutes) * intervalMinutes, 'minutes')
}

function buildAvailabilityOptions({
    busyIntervals,
    rangeStart,
    rangeEnd,
    timeZone,
    durationMinutes,
    maxOptions,
    slotIntervalMinutes,
    workingHoursStart,
    workingHoursEnd,
    includeWeekends,
    minFreeMinutesPerDay = 0,
}) {
    const options = []
    const skippedDays = []
    let day = rangeStart.clone().tz(timeZone).startOf('day')
    const lastDay = rangeEnd.clone().tz(timeZone).startOf('day')

    while (day.isSameOrBefore(lastDay, 'day') && options.length < maxOptions) {
        const dayOfWeek = day.day()
        if (includeWeekends || (dayOfWeek !== 0 && dayOfWeek !== 6)) {
            const date = day.format('YYYY-MM-DD')
            const dayStart = moment.tz(`${date}T${workingHoursStart}:00`, timeZone)
            const dayEnd = moment.tz(`${date}T${workingHoursEnd}:00`, timeZone)

            // AT-2278: a day the user has already filled up is skipped whole, before any slot
            // is generated. The load is measured across the entire working-hours window of the
            // day (see dayKeepsMinimumFreeTime) — which is why the caller fetches busy events
            // for whole days rather than only for the searched slice.
            const keepsMinimumFreeTime = dayKeepsMinimumFreeTime({
                capacityMinutes: dayEnd.diff(dayStart, 'minutes', true),
                busyMinutes: sumBusyMinutesInWindow(busyIntervals, dayStart.valueOf(), dayEnd.valueOf()),
                durationMinutes,
                minFreeMinutes: minFreeMinutesPerDay,
            })
            if (!keepsMinimumFreeTime) {
                skippedDays.push(date)
                day.add(1, 'day')
                continue
            }

            let candidate = moment.max(rangeStart, dayStart)
            const candidateLimit = moment.min(rangeEnd, dayEnd)
            candidate = ceilMomentToInterval(candidate, dayStart, slotIntervalMinutes)

            while (candidate.clone().add(durationMinutes, 'minutes').isSameOrBefore(candidateLimit)) {
                const candidateEnd = candidate.clone().add(durationMinutes, 'minutes')
                const conflict = busyIntervals.find(
                    interval => interval.startMs < candidateEnd.valueOf() && interval.endMs > candidate.valueOf()
                )

                if (conflict) {
                    candidate = ceilMomentToInterval(moment(conflict.endMs), dayStart, slotIntervalMinutes)
                    continue
                }

                options.push({
                    start: candidate.clone().tz(timeZone).format(),
                    end: candidateEnd.clone().tz(timeZone).format(),
                })
                if (options.length >= maxOptions) break
                candidate.add(slotIntervalMinutes, 'minutes')
            }
        }
        day.add(1, 'day')
    }

    return { options, skippedDays }
}

async function getGoogleBusyIntervalsForConnectedAccount({ userId, account, timeMin, timeMax, calendarId, timeZone }) {
    const calendar = await getCalendarClient(userId, account.projectId)
    const busyIntervals = []
    const seenPageTokens = new Set()
    let pageToken
    let pageCount = 0

    do {
        pageCount += 1
        if (pageCount > MAX_AVAILABILITY_PAGES_PER_CALENDAR) {
            throw new Error('Google Calendar availability exceeded the page limit.')
        }
        if (pageToken && seenPageTokens.has(pageToken)) throw new Error('Google Calendar pagination loop detected.')
        if (pageToken) seenPageTokens.add(pageToken)

        const response = await calendar.events.list({
            calendarId,
            timeMin,
            timeMax,
            showDeleted: false,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
            fields: 'nextPageToken,items(start,end,status,transparency)',
            ...(pageToken ? { pageToken } : {}),
        })

        busyIntervals.push(
            ...(Array.isArray(response?.data?.items) ? response.data.items : [])
                .map(event => normalizeGoogleBusyInterval(event, timeZone))
                .filter(Boolean)
        )
        pageToken = safeTrim(response?.data?.nextPageToken)
    } while (pageToken)

    return busyIntervals
}

async function findCalendarAvailabilityForAssistantRequest({
    userId,
    timeMin,
    timeMax,
    timeZone,
    calendarId,
    durationMinutes = DEFAULT_AVAILABILITY_DURATION_MINUTES,
    maxOptions = DEFAULT_AVAILABILITY_MAX_OPTIONS,
    slotIntervalMinutes = DEFAULT_AVAILABILITY_SLOT_INTERVAL_MINUTES,
    workingHoursStart = undefined,
    workingHoursEnd = undefined,
    includeWeekends = undefined,
    bufferBeforeMinutes = undefined,
    bufferAfterMinutes = undefined,
    // Request-level override. The caller may set this only for an explicit current-message
    // request for today/a same-day option; otherwise the saved meeting-link setting wins.
    allowSameDayBooking = false,
    // Left undefined on purpose: undefined means "use the user's saved setting" (default 4h),
    // while an explicit number — including 0, which disables the rule — is an override.
    minFreeHoursPerDay = undefined,
    // Server-controlled. Email uses this because its proposed slots can be sent directly to
    // external recipients and therefore must obey the same policy as the public meeting link.
    respectPublicMeetingLinkSettings = false,
}) {
    const requestedTimeZone = safeTrim(timeZone)
    if (requestedTimeZone && !moment.tz.zone(requestedTimeZone)) {
        return { success: false, options: [], message: `Unknown IANA timezone "${requestedTimeZone}".` }
    }

    const publicMeetingLinkSettingsResult = respectPublicMeetingLinkSettings
        ? await getPublicMeetingLinkSettings(userId)
        : { exists: false, settings: null }
    if (publicMeetingLinkSettingsResult.error) {
        return {
            success: false,
            options: [],
            message: 'Meeting availability settings could not be checked right now. Please try again later.',
        }
    }

    const publicMeetingLinkSettings = publicMeetingLinkSettingsResult.exists
        ? publicMeetingLinkSettingsResult.settings
        : null
    const publicMeetingLinkTimeZone = safeTrim(publicMeetingLinkSettings?.timeZone)
    const resolvedTimeZone =
        (publicMeetingLinkTimeZone && moment.tz.zone(publicMeetingLinkTimeZone) ? publicMeetingLinkTimeZone : '') ||
        (requestedTimeZone && moment.tz.zone(requestedTimeZone) ? requestedTimeZone : '') ||
        (await getUserDefaultTimeZone(userId)) ||
        'UTC'

    let rangeStart = parseAvailabilityBoundary(timeMin, resolvedTimeZone, 'timeMin')
    const rangeEnd = parseAvailabilityBoundary(timeMax, resolvedTimeZone, 'timeMax')
    if (!rangeEnd.isAfter(rangeStart)) {
        return { success: false, options: [], message: 'timeMax must be after timeMin.' }
    }
    if (rangeEnd.diff(rangeStart, 'days', true) > MAX_AVAILABILITY_RANGE_DAYS) {
        return {
            success: false,
            options: [],
            message: `Availability searches are limited to ${MAX_AVAILABILITY_RANGE_DAYS} days.`,
        }
    }

    const normalizedDurationMinutes = normalizeBoundedInteger(
        durationMinutes,
        DEFAULT_AVAILABILITY_DURATION_MINUTES,
        5,
        480
    )
    const normalizedMaxOptions = normalizeBoundedInteger(
        maxOptions,
        DEFAULT_AVAILABILITY_MAX_OPTIONS,
        1,
        MAX_AVAILABILITY_OPTIONS
    )
    const normalizedSlotIntervalMinutes = normalizeBoundedInteger(
        slotIntervalMinutes,
        DEFAULT_AVAILABILITY_SLOT_INTERVAL_MINUTES,
        5,
        120
    )
    const savedSettingsApply = !!publicMeetingLinkSettings
    const savedWorkingHoursStart = safeTrim(publicMeetingLinkSettings?.workingHoursStart)
    const savedWorkingHoursEnd = safeTrim(publicMeetingLinkSettings?.workingHoursEnd)
    const explicitWorkingHoursStart = safeTrim(workingHoursStart)
    const explicitWorkingHoursEnd = safeTrim(workingHoursEnd)
    const normalizedWorkingHoursStart =
        savedSettingsApply && !explicitWorkingHoursStart
            ? /^([01]\d|2[0-3]):[0-5]\d$/.test(savedWorkingHoursStart)
                ? savedWorkingHoursStart
                : DEFAULT_WORKING_HOURS_START
            : normalizeClockTime(workingHoursStart, DEFAULT_WORKING_HOURS_START)
    const normalizedWorkingHoursEnd =
        savedSettingsApply && !explicitWorkingHoursEnd
            ? /^([01]\d|2[0-3]):[0-5]\d$/.test(savedWorkingHoursEnd)
                ? savedWorkingHoursEnd
                : DEFAULT_WORKING_HOURS_END
            : normalizeClockTime(workingHoursEnd, DEFAULT_WORKING_HOURS_END)
    if (normalizedWorkingHoursEnd <= normalizedWorkingHoursStart) {
        return { success: false, options: [], message: 'workingHoursEnd must be after workingHoursStart.' }
    }

    const normalizedIncludeWeekends =
        savedSettingsApply && typeof includeWeekends !== 'boolean'
            ? publicMeetingLinkSettings.includeWeekends === true
            : includeWeekends === true
    const hasBufferBeforeOverride = bufferBeforeMinutes !== undefined && bufferBeforeMinutes !== null
    const hasBufferAfterOverride = bufferAfterMinutes !== undefined && bufferAfterMinutes !== null
    const normalizedBufferBeforeMinutes = normalizeBoundedInteger(
        savedSettingsApply && !hasBufferBeforeOverride
            ? publicMeetingLinkSettings.bufferBeforeMinutes
            : bufferBeforeMinutes,
        0,
        0,
        240
    )
    const normalizedBufferAfterMinutes = normalizeBoundedInteger(
        savedSettingsApply && !hasBufferAfterOverride
            ? publicMeetingLinkSettings.bufferAfterMinutes
            : bufferAfterMinutes,
        0,
        0,
        240
    )

    // A saved settings document means the owner has configured the public meeting policy.
    // As on the public link, only a strict boolean true permits today; older documents with
    // no field retain the safer no-same-day behavior. An explicit current-request override
    // may allow today without changing the persisted setting. The boundary is the host's day.
    if (savedSettingsApply && publicMeetingLinkSettings.allowSameDayBooking !== true && allowSameDayBooking !== true) {
        const earliestBookableStart = moment().tz(resolvedTimeZone).startOf('day').add(1, 'day')
        if (!rangeEnd.isAfter(earliestBookableStart)) {
            return {
                success: true,
                timeZone: resolvedTimeZone,
                durationMinutes: normalizedDurationMinutes,
                requestedRange: {
                    start: rangeStart.clone().tz(resolvedTimeZone).format(),
                    end: rangeEnd.clone().tz(resolvedTimeZone).format(),
                },
                workingHours: {
                    start: normalizedWorkingHoursStart,
                    end: normalizedWorkingHoursEnd,
                    includeWeekends: normalizedIncludeWeekends,
                    bufferBeforeMinutes: normalizedBufferBeforeMinutes,
                    bufferAfterMinutes: normalizedBufferAfterMinutes,
                },
                options: [],
                message:
                    'No free meeting options were found in the requested range because the saved public meeting-link settings do not allow same-day meetings.',
            }
        }
        if (rangeStart.isBefore(earliestBookableStart)) {
            rangeStart = earliestBookableStart
        }
    }

    const hasMinFreeHoursOverride = minFreeHoursPerDay !== undefined && minFreeHoursPerDay !== null
    const normalizedMinFreeHoursPerDay = hasMinFreeHoursOverride
        ? normalizeMinFreeHoursPerDay(minFreeHoursPerDay)
        : savedSettingsApply
          ? normalizeMinFreeHoursPerDay(publicMeetingLinkSettings.minFreeHoursPerDay)
          : await getMinFreeHoursPerDayForUser(userId)
    const minFreeMinutesPerDay = minFreeHoursToMinutes(normalizedMinFreeHoursPerDay)

    const normalizedCalendarId = normalizeCalendarId(calendarId)
    // Busy events are fetched for WHOLE days covering the requested range, not just the
    // requested slice: the daily-free-time rule has to see the meetings that sit outside the
    // searched window but inside the same working day. Slot generation is still clamped to
    // the requested range below, so the wider fetch cannot invent options outside it.
    const loadWindowStart = moment.min(rangeStart.clone(), rangeStart.clone().tz(resolvedTimeZone).startOf('day'))
    const loadWindowEnd = moment.max(rangeEnd.clone(), rangeEnd.clone().tz(resolvedTimeZone).endOf('day'))
    const normalizedTimeMin = loadWindowStart.toISOString()
    const normalizedTimeMax = loadWindowEnd.toISOString()
    const googleAccounts = await getConnectedCalendarAccounts(userId)
    const googleResults = await settleAll(
        googleAccounts.map(account =>
            getGoogleBusyIntervalsForConnectedAccount({
                userId,
                account,
                timeMin: normalizedTimeMin,
                timeMax: normalizedTimeMax,
                calendarId: normalizedCalendarId,
                timeZone: resolvedTimeZone,
            })
        )
    )
    const microsoftResult = await getMicrosoftCalendarBusyIntervalsForAssistantRequest({
        userId,
        timeMin: normalizedTimeMin,
        timeMax: normalizedTimeMax,
        timeZone: resolvedTimeZone,
    }).catch(() => ({
        busyIntervals: [],
        searchedCalendarCount: 0,
        failedCalendarCount: 1,
    }))

    const busyIntervals = [...microsoftResult.busyIntervals]
    let searchedCalendarCount = microsoftResult.searchedCalendarCount
    let failedCalendarCount = microsoftResult.failedCalendarCount
    googleResults.forEach(entry => {
        if (entry.status === 'fulfilled') {
            searchedCalendarCount += 1
            busyIntervals.push(...entry.value)
        } else {
            failedCalendarCount += 1
        }
    })

    if (searchedCalendarCount === 0) {
        return {
            success: false,
            options: [],
            searchedCalendarCount: 0,
            failedCalendarCount,
            message: 'No connected Calendar account could be read. Please connect or reconnect Calendar first.',
        }
    }
    if (failedCalendarCount > 0) {
        return {
            success: false,
            options: [],
            searchedCalendarCount,
            failedCalendarCount,
            message: 'Calendar availability could not be checked completely. Please reconnect Calendar and try again.',
        }
    }

    const bufferedBusyIntervals = applyBusyIntervalBuffers(
        busyIntervals,
        normalizedBufferBeforeMinutes,
        normalizedBufferAfterMinutes
    )
    const mergedBusyIntervals = mergeBusyIntervals(
        bufferedBusyIntervals,
        loadWindowStart.valueOf(),
        loadWindowEnd.valueOf()
    )
    const buildOptions = minFreeMinutes =>
        buildAvailabilityOptions({
            busyIntervals: mergedBusyIntervals,
            rangeStart,
            rangeEnd,
            timeZone: resolvedTimeZone,
            durationMinutes: normalizedDurationMinutes,
            maxOptions: normalizedMaxOptions,
            slotIntervalMinutes: normalizedSlotIntervalMinutes,
            workingHoursStart: normalizedWorkingHoursStart,
            workingHoursEnd: normalizedWorkingHoursEnd,
            includeWeekends: normalizedIncludeWeekends,
            minFreeMinutesPerDay: minFreeMinutes,
        })

    const constrained = buildOptions(minFreeMinutesPerDay)

    // Soft fallback: the minimum is a guardrail, not a wall. If honouring it leaves the user
    // with nothing at all in the whole requested range, offer the options anyway and say so
    // (minFreeHours.applied === false) so the assistant can flag that these eat into the
    // protected free time instead of answering "no availability" to someone who asked.
    let options = constrained.options
    let minFreeHoursApplied = true
    if (options.length === 0 && minFreeMinutesPerDay > 0 && constrained.skippedDays.length > 0) {
        const relaxed = buildOptions(0)
        if (relaxed.options.length > 0) {
            options = relaxed.options
            minFreeHoursApplied = false
        }
    }

    return {
        success: true,
        timeZone: resolvedTimeZone,
        durationMinutes: normalizedDurationMinutes,
        requestedRange: {
            start: rangeStart.clone().tz(resolvedTimeZone).format(),
            end: rangeEnd.clone().tz(resolvedTimeZone).format(),
        },
        workingHours: {
            start: normalizedWorkingHoursStart,
            end: normalizedWorkingHoursEnd,
            includeWeekends: normalizedIncludeWeekends,
            bufferBeforeMinutes: normalizedBufferBeforeMinutes,
            bufferAfterMinutes: normalizedBufferAfterMinutes,
        },
        // AT-2278. `skippedDays` carries dates only — no event data — so the privacy contract
        // of this tool ("free options, never calendar contents") is unchanged.
        minFreeHours: {
            perDay: normalizedMinFreeHoursPerDay,
            source: hasMinFreeHoursOverride ? 'request' : 'settings',
            applied: minFreeHoursApplied,
            skippedDays: constrained.skippedDays,
        },
        searchedCalendarCount,
        failedCalendarCount,
        options,
        message: buildAvailabilityMessage({
            optionCount: options.length,
            minFreeHoursPerDay: normalizedMinFreeHoursPerDay,
            minFreeHoursApplied,
            skippedDayCount: constrained.skippedDays.length,
        }),
    }
}

function buildAvailabilityMessage({ optionCount, minFreeHoursPerDay, minFreeHoursApplied, skippedDayCount }) {
    if (optionCount === 0) {
        return 'No free meeting options were found in the requested range.'
    }

    const found = `Found ${optionCount} free meeting option${optionCount === 1 ? '' : 's'}.`
    if (!minFreeHoursApplied) {
        return `${found} Every day in this range is already at the user's limit of ${minFreeHoursPerDay}h of free calendar time per day, so these options cut into that protected time — say so when offering them.`
    }
    if (skippedDayCount > 0) {
        return `${found} ${skippedDayCount} day${
            skippedDayCount === 1 ? ' was' : 's were'
        } skipped to keep at least ${minFreeHoursPerDay}h of free calendar time per day.`
    }
    return found
}

function normalizeCalendarEvent(event, account, calendarId, includeDescription = true) {
    return {
        projectId: account.projectId,
        calendarEmail: account.calendarEmail,
        calendarId: calendarId || DEFAULT_CALENDAR_ID,
        eventId: event?.id || '',
        summary: event?.summary || '',
        description: includeDescription ? event?.description || '' : '',
        location: event?.location || '',
        status: event?.status || '',
        htmlLink: event?.htmlLink || '',
        start: event?.start || null,
        end: event?.end || null,
        attendees: Array.isArray(event?.attendees)
            ? event.attendees.map(attendee => ({
                  email: attendee?.email || '',
                  displayName: attendee?.displayName || '',
                  responseStatus: attendee?.responseStatus || '',
                  optional: !!attendee?.optional,
                  resource: !!attendee?.resource,
              }))
            : [],
        organizer: event?.organizer || null,
        creator: event?.creator || null,
        // hangoutLink is the canonical Google Meet URL and the first thing
        // extractMeetingJoinUrl looks at, so it has to survive normalization.
        hangoutLink: event?.hangoutLink || '',
        conferenceData: event?.conferenceData || null,
        recurringEventId: event?.recurringEventId || null,
    }
}

async function searchConnectedAccount({
    userId,
    account,
    query,
    timeMin,
    timeMax,
    calendarId,
    limit,
    includeDescription,
}) {
    const calendar = await getCalendarClient(userId, account.projectId)
    const response = await calendar.events.list({
        calendarId,
        q: query || undefined,
        timeMin: timeMin || undefined,
        timeMax: timeMax || undefined,
        showDeleted: false,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: limit,
    })

    const items = Array.isArray(response?.data?.items) ? response.data.items : []

    return {
        searchedAccount: account,
        results: items.map(event => normalizeCalendarEvent(event, account, calendarId, includeDescription)),
    }
}

async function probeCalendarAccess(account, userId, calendarId) {
    const calendar = await getCalendarClient(userId, account.projectId)
    await calendar.calendars.get({ calendarId })
    return account
}

async function resolveCalendarAccountForWrite({ userId, calendarId }) {
    const resolvedCalendarId = normalizeCalendarId(calendarId)
    const accounts = await getConnectedCalendarAccounts(userId)
    const microsoftAccounts = await getConnectedMicrosoftCalendarAccounts(userId).catch(() => [])

    if (accounts.length === 0 && microsoftAccounts.length === 0) {
        return {
            success: false,
            code: 'calendar_not_connected',
            message: 'No connected Google Calendar accounts were found for this user. Please connect Calendar first.',
            accounts: [],
        }
    }

    if (accounts.length === 1) {
        return {
            success: true,
            account: accounts[0],
            calendarId: resolvedCalendarId,
            accounts,
        }
    }

    if (!calendarId) {
        const defaultAccount = accounts.find(account => account.calendarDefault)
        if (defaultAccount) {
            return {
                success: true,
                account: defaultAccount,
                calendarId: resolvedCalendarId,
                accounts,
            }
        }
    }

    const emailMatch = accounts.filter(
        account =>
            account.calendarEmail &&
            resolvedCalendarId !== DEFAULT_CALENDAR_ID &&
            account.calendarEmail.toLowerCase() === resolvedCalendarId.toLowerCase()
    )
    if (emailMatch.length === 1) {
        return {
            success: true,
            account: emailMatch[0],
            calendarId: resolvedCalendarId,
            accounts,
        }
    }

    if (!calendarId) {
        return {
            success: false,
            code: 'calendar_account_ambiguous',
            message:
                'Multiple Google Calendar accounts are connected. Please provide a calendarId or connect only one Calendar account for assistant writes.',
            accounts,
        }
    }

    const settled = await settleAll(accounts.map(account => probeCalendarAccess(account, userId, resolvedCalendarId)))
    const accessibleAccounts = settled
        .filter(entry => entry.status === 'fulfilled' && entry.value)
        .map(entry => entry.value)

    if (accessibleAccounts.length === 1) {
        return {
            success: true,
            account: accessibleAccounts[0],
            calendarId: resolvedCalendarId,
            accounts,
        }
    }

    if (accessibleAccounts.length > 1) {
        return {
            success: false,
            code: 'calendar_account_ambiguous',
            message: `Calendar "${resolvedCalendarId}" is accessible from multiple connected Google accounts. Please specify a more specific calendar target.`,
            accounts: accessibleAccounts,
        }
    }

    return {
        success: false,
        code: 'calendar_not_found',
        message: `Calendar "${resolvedCalendarId}" was not found in the connected Google Calendar accounts.`,
        accounts,
    }
}

async function resolveEventTargetForWrite({ userId, eventId, calendarId }) {
    const accountResolution = await resolveCalendarAccountForWrite({ userId, calendarId })
    if (calendarId) return accountResolution
    if (accountResolution.success && (accountResolution.accounts || []).length === 1) return accountResolution

    const accounts = accountResolution.accounts || (await getConnectedCalendarAccounts(userId))
    if (accounts.length === 0) return accountResolution

    if (accountResolution.success && accountResolution.account?.calendarDefault) {
        try {
            const calendar = await getCalendarClient(userId, accountResolution.account.projectId)
            const response = await calendar.events.get({
                calendarId: DEFAULT_CALENDAR_ID,
                eventId,
            })

            if (response?.data) {
                return {
                    success: true,
                    account: accountResolution.account,
                    calendarId: DEFAULT_CALENDAR_ID,
                    event: response.data,
                    accounts,
                }
            }
        } catch (error) {}
    }

    const settled = await settleAll(
        accounts.map(async account => {
            const calendar = await getCalendarClient(userId, account.projectId)
            const response = await calendar.events.get({
                calendarId: DEFAULT_CALENDAR_ID,
                eventId,
            })
            return {
                account,
                calendarId: DEFAULT_CALENDAR_ID,
                event: response?.data || null,
            }
        })
    )

    const matches = settled
        .filter(entry => entry.status === 'fulfilled' && entry.value?.event)
        .map(entry => entry.value)

    if (matches.length === 1) {
        return {
            success: true,
            account: matches[0].account,
            calendarId: matches[0].calendarId,
            event: matches[0].event,
            accounts,
        }
    }

    if (matches.length > 1) {
        return {
            success: false,
            code: 'calendar_event_ambiguous',
            message:
                'This eventId exists in multiple connected primary calendars. Please provide calendarId to update or delete the correct event.',
            accounts: matches.map(match => match.account),
        }
    }

    return {
        success: false,
        code: 'calendar_event_not_found',
        message: `Event "${eventId}" was not found in the connected primary calendars. Provide calendarId if the event is on a non-primary calendar.`,
        accounts,
    }
}

async function searchCalendarEventsForAssistantRequest({
    userId,
    query = '',
    timeMin,
    timeMax,
    calendarId,
    limit = DEFAULT_SEARCH_LIMIT,
    includeDescription = true,
}) {
    const trimmedQuery = safeTrim(query)
    const normalizedCalendarId = normalizeCalendarId(calendarId)
    const normalizedLimit = normalizeLimit(limit)
    const [accounts, microsoftAccounts] = await Promise.all([
        getConnectedCalendarAccounts(userId),
        getConnectedMicrosoftCalendarAccounts(userId).catch(() => []),
    ])

    if (accounts.length === 0 && microsoftAccounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message: 'No connected Calendar accounts were found for this user. Please connect Calendar first.',
        }
    }

    if (!trimmedQuery && !timeMin && !timeMax) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message: 'A calendar search query or time range is required.',
        }
    }

    const settledResults = await settleAll(
        accounts.map(account =>
            searchConnectedAccount({
                userId,
                account,
                query: trimmedQuery,
                timeMin,
                timeMax,
                calendarId: normalizedCalendarId,
                limit: normalizedLimit,
                includeDescription: includeDescription !== false,
            })
        )
    )

    const searchedAccounts = []
    const accountsWithErrors = []
    const mergedResults = []

    settledResults.forEach((entry, index) => {
        const account = accounts[index]
        if (entry.status === 'fulfilled') {
            searchedAccounts.push(entry.value.searchedAccount)
            mergedResults.push(...entry.value.results)
            return
        }

        accountsWithErrors.push({
            projectId: account.projectId,
            calendarEmail: account.calendarEmail,
            error: entry.reason?.message || 'Unknown Calendar search error',
        })
    })

    if (microsoftAccounts.length > 0) {
        const microsoftResult = await searchMicrosoftCalendarEventsForAssistantRequest({
            userId,
            query: trimmedQuery,
            timeMin,
            timeMax,
            calendarId,
            limit: normalizedLimit,
            includeDescription,
        })
        searchedAccounts.push(...(microsoftResult.searchedAccounts || []))
        accountsWithErrors.push(...(microsoftResult.accountsWithErrors || []))
        mergedResults.push(...(microsoftResult.results || []))
    }

    const sortedResults = mergedResults
        .sort((a, b) => {
            const aValue = a?.start?.dateTime || a?.start?.date || ''
            const bValue = b?.start?.dateTime || b?.start?.date || ''
            return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
        })
        .slice(0, normalizedLimit)

    const partialFailure = accountsWithErrors.length > 0 && searchedAccounts.length > 0
    if (searchedAccounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors,
            partialFailure: false,
            results: [],
            message: 'Calendar search failed for all connected accounts. Please reconnect Calendar and try again.',
        }
    }

    return {
        success: true,
        query: trimmedQuery,
        searchedAccounts,
        accountsWithErrors,
        partialFailure,
        results: sortedResults,
        message: sortedResults.length > 0 ? null : 'No matching calendar events were found in the connected accounts.',
    }
}

function buildEventPayload(args, { requireRange = true } = {}) {
    const timeZone = safeTrim(args.timeZone)
    const summary = safeTrim(args.summary)
    const location = safeTrim(args.location)
    const description = typeof args.description === 'string' ? args.description : undefined
    const attendees = normalizeAttendees(args.attendees)
    const hasAttendeesField = args.attendees !== undefined

    const hasStart = args.start !== undefined
    const hasEnd = args.end !== undefined
    const hasTimeUpdates = hasStart || hasEnd

    if (requireRange && (!hasStart || !hasEnd)) {
        throw new Error('Both start and end are required.')
    }

    if (!requireRange && hasStart !== hasEnd) {
        throw new Error('When updating event times, provide both start and end.')
    }

    const payload = {}
    if (summary) payload.summary = summary
    if (description !== undefined) payload.description = description
    if (location) payload.location = location
    if (hasAttendeesField) payload.attendees = attendees

    if (hasTimeUpdates) {
        const start = normalizeEventDateTimeInput(args.start, timeZone || undefined)
        const end = normalizeEventDateTimeInput(args.end, timeZone || undefined)
        validateEventRange(start, end)
        payload.start = start
        payload.end = end
    }

    return payload
}

/**
 * Insert a Google event, asking Calendar to provision a Google Meet.
 *
 * Conferencing is best-effort: if Google refuses the conference outright the
 * event is inserted again without it, so a booking is never lost because Meet
 * is unavailable. Only definitive 400/403 rejections are retried — see
 * isConferencingRejection.
 */
async function insertGoogleEventWithConferencing(calendar, calendarId, payload, addConferencing) {
    if (!shouldAddConferencing(payload, addConferencing)) {
        const response = await calendar.events.insert({ calendarId, requestBody: payload })
        return { data: response?.data || {}, conferencingRequested: false }
    }

    try {
        const response = await calendar.events.insert({
            calendarId,
            requestBody: { ...payload, conferenceData: buildGoogleMeetCreateRequest() },
            conferenceDataVersion: GOOGLE_CONFERENCE_DATA_VERSION,
        })
        const data = response?.data || {}
        if (!googleConferenceSucceeded(data)) {
            console.log('createCalendarEvent: Google accepted the event but did not provision a Meet conference')
        }
        return { data, conferencingRequested: true }
    } catch (error) {
        if (!isConferencingRejection(error)) throw error
        console.log(
            `createCalendarEvent: Google Meet conferencing was rejected (${
                error?.message || 'unknown error'
            }); creating the event without a meeting link`
        )
        const response = await calendar.events.insert({ calendarId, requestBody: payload })
        return { data: response?.data || {}, conferencingRequested: true, conferencingFailed: true }
    }
}

async function createCalendarEventForAssistantRequest({
    userId,
    summary,
    description,
    start,
    end,
    timeZone,
    location,
    attendees,
    calendarId,
    addConferencing,
}) {
    const trimmedSummary = safeTrim(summary)
    if (!trimmedSummary) {
        return {
            success: false,
            message: 'A calendar event summary is required.',
        }
    }

    const resolvedTimeZone = safeTrim(timeZone) || (await getUserDefaultTimeZone(userId))
    const microsoftAccounts = await getConnectedMicrosoftCalendarAccounts(userId).catch(() => [])
    const googleAccounts = await getConnectedCalendarAccounts(userId).catch(() => [])
    if (microsoftAccounts.find(account => account.calendarDefault) || googleAccounts.length === 0) {
        return createMicrosoftCalendarEventForAssistantRequest({
            userId,
            summary,
            description,
            start,
            end,
            timeZone: resolvedTimeZone,
            location,
            attendees,
            calendarId,
            addConferencing,
        })
    }
    const resolution = await resolveCalendarAccountForWrite({ userId, calendarId })
    if (!resolution.success) {
        return {
            success: false,
            code: resolution.code,
            accounts: resolution.accounts || [],
            message: resolution.message,
        }
    }

    const payload = buildEventPayload(
        {
            summary: trimmedSummary,
            description,
            start,
            end,
            timeZone: resolvedTimeZone,
            location,
            attendees,
        },
        { requireRange: true }
    )

    const calendar = await getCalendarClient(userId, resolution.account.projectId)
    const inserted = await insertGoogleEventWithConferencing(calendar, resolution.calendarId, payload, addConferencing)

    const event = normalizeCalendarEvent(inserted.data, resolution.account, resolution.calendarId, true)
    const joinLink = extractMeetingJoinUrl(event)

    return {
        success: true,
        provider: 'google',
        calendarEmail: resolution.account.calendarEmail,
        projectId: resolution.account.projectId,
        calendarId: resolution.calendarId,
        event,
        joinUrl: joinLink?.joinUrl || '',
        joinProvider: joinLink?.joinProvider || '',
        conferencingRequested: !!inserted.conferencingRequested,
        message: joinLink?.joinUrl
            ? 'Calendar event created successfully with a Google Meet link.'
            : 'Calendar event created successfully.',
    }
}

async function updateCalendarEventForAssistantRequest({
    userId,
    eventId,
    calendarId,
    summary,
    description,
    start,
    end,
    timeZone,
    location,
    attendees,
}) {
    const trimmedEventId = safeTrim(eventId)
    if (!trimmedEventId) {
        return {
            success: false,
            message: 'An eventId is required to update a calendar event.',
        }
    }

    const resolvedTimeZone = safeTrim(timeZone) || (await getUserDefaultTimeZone(userId))
    const resolution = await resolveEventTargetForWrite({ userId, eventId: trimmedEventId, calendarId })
    if (!resolution.success) {
        return updateMicrosoftCalendarEventForAssistantRequest({
            userId,
            eventId,
            calendarId,
            summary,
            description,
            start,
            end,
            timeZone: resolvedTimeZone,
            location,
            attendees,
        })
    }

    const payload = buildEventPayload(
        {
            summary,
            description,
            start,
            end,
            timeZone: resolvedTimeZone,
            location,
            attendees,
        },
        { requireRange: false }
    )

    if (Object.keys(payload).length === 0) {
        return {
            success: false,
            message: 'No calendar event changes were provided.',
        }
    }

    const calendar = await getCalendarClient(userId, resolution.account.projectId)
    const response = await calendar.events.patch({
        calendarId: resolution.calendarId,
        eventId: trimmedEventId,
        requestBody: payload,
    })

    return {
        success: true,
        calendarEmail: resolution.account.calendarEmail,
        projectId: resolution.account.projectId,
        calendarId: resolution.calendarId,
        event: normalizeCalendarEvent(response?.data || {}, resolution.account, resolution.calendarId, true),
        message: 'Calendar event updated successfully.',
    }
}

async function deleteCalendarEventForAssistantRequest({ userId, eventId, calendarId }) {
    const trimmedEventId = safeTrim(eventId)
    if (!trimmedEventId) {
        return {
            success: false,
            message: 'An eventId is required to delete a calendar event.',
        }
    }

    const resolution = await resolveEventTargetForWrite({ userId, eventId: trimmedEventId, calendarId })
    if (!resolution.success) {
        return deleteMicrosoftCalendarEventForAssistantRequest({ userId, eventId: trimmedEventId, calendarId })
    }

    const calendar = await getCalendarClient(userId, resolution.account.projectId)
    await calendar.events.delete({
        calendarId: resolution.calendarId,
        eventId: trimmedEventId,
    })

    return {
        success: true,
        calendarEmail: resolution.account.calendarEmail,
        projectId: resolution.account.projectId,
        calendarId: resolution.calendarId,
        eventId: trimmedEventId,
        message: 'Calendar event deleted successfully.',
    }
}

module.exports = {
    searchCalendarEventsForAssistantRequest,
    findCalendarAvailabilityForAssistantRequest,
    createCalendarEventForAssistantRequest,
    updateCalendarEventForAssistantRequest,
    deleteCalendarEventForAssistantRequest,
    __private__: {
        getActiveProjectIds,
        normalizeLimit,
        normalizeEventDateTimeInput,
        validateEventRange,
        getConnectedCalendarAccounts,
        getUserDefaultTimeZone,
        applyBusyIntervalBuffers,
        buildAvailabilityOptions,
        mergeBusyIntervals,
        resolveCalendarAccountForWrite,
        resolveEventTargetForWrite,
        normalizeCalendarEvent,
        mergeBusyIntervals,
        buildAvailabilityOptions,
        buildEventPayload,
        hasExplicitDateTimeTimezone,
        resolveUserIanaTimeZone,
    },
}
