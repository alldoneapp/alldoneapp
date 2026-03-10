'use strict'

const admin = require('firebase-admin')
const { google } = require('googleapis')
const moment = require('moment-timezone')

const { getAccessToken, getOAuth2Client } = require('../GoogleOAuth/googleOAuthHandler')

const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20
const DEFAULT_CALENDAR_ID = 'primary'

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
    const accessToken = await getAccessToken(userId, projectId, 'calendar')
    const oauth2Client = getOAuth2Client()
    oauth2Client.setCredentials({ access_token: accessToken })
    return google.calendar({ version: 'v3', auth: oauth2Client })
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

        const calendarEmail =
            typeof connection.calendarEmail === 'string' ? connection.calendarEmail.trim().toLowerCase() : ''
        const dedupeKey = calendarEmail || projectId
        if (seenKeys.has(dedupeKey)) return
        seenKeys.add(dedupeKey)

        accounts.push({
            projectId,
            calendarEmail: calendarEmail || null,
        })
    })

    return accounts
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

    if (accounts.length === 0) {
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
    if (accountResolution.success || calendarId) return accountResolution

    const accounts = accountResolution.accounts || (await getConnectedCalendarAccounts(userId))
    if (accounts.length === 0) return accountResolution

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
    const accounts = await getConnectedCalendarAccounts(userId)

    if (accounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message: 'No connected Google Calendar accounts were found for this user. Please connect Calendar first.',
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
}) {
    const trimmedSummary = safeTrim(summary)
    if (!trimmedSummary) {
        return {
            success: false,
            message: 'A calendar event summary is required.',
        }
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
            timeZone,
            location,
            attendees,
        },
        { requireRange: true }
    )

    const calendar = await getCalendarClient(userId, resolution.account.projectId)
    const response = await calendar.events.insert({
        calendarId: resolution.calendarId,
        requestBody: payload,
    })

    return {
        success: true,
        calendarEmail: resolution.account.calendarEmail,
        projectId: resolution.account.projectId,
        calendarId: resolution.calendarId,
        event: normalizeCalendarEvent(response?.data || {}, resolution.account, resolution.calendarId, true),
        message: 'Calendar event created successfully.',
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

    const resolution = await resolveEventTargetForWrite({ userId, eventId: trimmedEventId, calendarId })
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
            summary,
            description,
            start,
            end,
            timeZone,
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
        return {
            success: false,
            code: resolution.code,
            accounts: resolution.accounts || [],
            message: resolution.message,
        }
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
    createCalendarEventForAssistantRequest,
    updateCalendarEventForAssistantRequest,
    deleteCalendarEventForAssistantRequest,
    __private__: {
        getActiveProjectIds,
        normalizeLimit,
        normalizeEventDateTimeInput,
        validateEventRange,
        getConnectedCalendarAccounts,
        resolveCalendarAccountForWrite,
        resolveEventTargetForWrite,
        normalizeCalendarEvent,
        buildEventPayload,
    },
}
