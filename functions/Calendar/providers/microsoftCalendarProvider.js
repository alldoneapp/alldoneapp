'use strict'

const admin = require('firebase-admin')
const moment = require('moment-timezone')
const { buildQuery, encodePath, getMicrosoftGraphClient } = require('../../MicrosoftGraph/graphClient')
const { normalizeEmailAddress, resolveCalendarConnection } = require('../../Integrations/providerConnections')

const DEFAULT_CALENDAR_ID = 'primary'
const DEFAULT_SEARCH_LIMIT = 10
const MAX_SEARCH_LIMIT = 20
const MAX_AVAILABILITY_PAGES_PER_CALENDAR = 100

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

function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : ''
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

function normalizeAttendees(attendees) {
    if (!Array.isArray(attendees)) return []
    return attendees
        .map(attendee => {
            const emailAddress = typeof attendee === 'string' ? attendee.trim() : safeTrim(attendee.email)
            if (!emailAddress) return null
            return {
                emailAddress: { address: emailAddress, name: safeTrim(attendee.displayName) || emailAddress },
                type: 'required',
            }
        })
        .filter(Boolean)
}

function normalizeEventDateTimeInput(value, timeZone) {
    if (typeof value === 'string') {
        return {
            dateTime: value,
            timeZone: timeZone || 'UTC',
        }
    }

    if (value?.date) {
        return {
            dateTime: `${value.date}T00:00:00`,
            timeZone: timeZone || 'UTC',
        }
    }

    return {
        dateTime: value?.dateTime || '',
        timeZone: value?.timeZone || timeZone || 'UTC',
    }
}

function toGoogleDateTime(graphDate = {}) {
    if (!graphDate?.dateTime) return null
    return {
        dateTime: graphDate.dateTime,
        timeZone: graphDate.timeZone || 'UTC',
    }
}

function normalizeCalendarEvent(event = {}, account = {}, calendarId = DEFAULT_CALENDAR_ID, includeDescription = true) {
    return {
        provider: 'microsoft',
        projectId: account.projectId,
        calendarEmail: account.calendarEmail,
        calendarId: calendarId || DEFAULT_CALENDAR_ID,
        eventId: event.id || '',
        summary: event.subject || '',
        description: includeDescription ? event.bodyPreview || event.body?.content || '' : '',
        location: event.location?.displayName || '',
        status: event.isCancelled ? 'cancelled' : 'confirmed',
        htmlLink: event.webLink || '',
        start: toGoogleDateTime(event.start),
        end: toGoogleDateTime(event.end),
        attendees: Array.isArray(event.attendees)
            ? event.attendees.map(attendee => ({
                  email: attendee?.emailAddress?.address || '',
                  displayName: attendee?.emailAddress?.name || '',
                  responseStatus: attendee?.status?.response || '',
                  optional: attendee?.type === 'optional',
                  resource: attendee?.type === 'resource',
              }))
            : [],
        organizer: event.organizer?.emailAddress
            ? {
                  email: event.organizer.emailAddress.address || '',
                  displayName: event.organizer.emailAddress.name || '',
              }
            : null,
        creator: event.organizer?.emailAddress || null,
        conferenceData: event.onlineMeeting || null,
        recurringEventId: event.seriesMasterId || null,
    }
}

async function getConnectedMicrosoftCalendarAccounts(userId) {
    const userDoc = await admin.firestore().collection('users').doc(userId).get()
    if (!userDoc.exists) throw new Error('User not found')

    const userData = userDoc.data() || {}
    const activeProjectIds = getActiveProjectIds(userData)
    const seenKeys = new Set()
    const accounts = []

    activeProjectIds.forEach(projectId => {
        const resolved = resolveCalendarConnection(userData.apisConnected?.[projectId])
        if (!resolved.connected || resolved.provider !== 'microsoft') return

        const calendarEmail = normalizeEmailAddress(resolved.emailAddress)
        const dedupeKey = calendarEmail || projectId
        if (seenKeys.has(dedupeKey)) return
        seenKeys.add(dedupeKey)

        accounts.push({
            projectId,
            provider: 'microsoft',
            calendarEmail: calendarEmail || null,
            calendarDefault: resolved.isDefault,
        })
    })

    return accounts
}

function buildEventPayload(args, { requireRange = true } = {}) {
    const payload = {}
    const summary = safeTrim(args.summary)
    if (summary) payload.subject = summary
    if (args.description !== undefined) payload.body = { contentType: 'Text', content: String(args.description || '') }
    if (safeTrim(args.location)) payload.location = { displayName: safeTrim(args.location) }
    if (args.attendees !== undefined) payload.attendees = normalizeAttendees(args.attendees)

    const hasStart = args.start !== undefined
    const hasEnd = args.end !== undefined
    if (requireRange && (!hasStart || !hasEnd)) throw new Error('Both start and end are required.')
    if (!requireRange && hasStart !== hasEnd) throw new Error('When updating event times, provide both start and end.')

    if (hasStart && hasEnd) {
        payload.start = normalizeEventDateTimeInput(args.start, args.timeZone)
        payload.end = normalizeEventDateTimeInput(args.end, args.timeZone)
        if (!moment(payload.end.dateTime).isAfter(moment(payload.start.dateTime))) {
            throw new Error('Event end must be after event start.')
        }
    }

    return payload
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
    const client = await getMicrosoftGraphClient(userId, account.projectId, 'calendar')
    const startDateTime = timeMin || moment().startOf('day').toISOString()
    const endDateTime = timeMax || moment().add(30, 'days').endOf('day').toISOString()
    const response = await client.request(
        `/me/calendarView${buildQuery({
            startDateTime,
            endDateTime,
            $top: limit,
            $orderby: 'start/dateTime',
            $select:
                'id,subject,bodyPreview,body,location,isCancelled,webLink,start,end,attendees,organizer,onlineMeeting,seriesMasterId',
        })}`,
        { headers: { Prefer: 'outlook.body-content-type="text",outlook.timezone="UTC"' } }
    )
    const queryText = safeTrim(query).toLowerCase()
    const events = Array.isArray(response?.value) ? response.value : []
    const filtered = queryText
        ? events.filter(event =>
              [event.subject, event.bodyPreview, event.location?.displayName]
                  .map(value => String(value || '').toLowerCase())
                  .some(value => value.includes(queryText))
          )
        : events

    return {
        searchedAccount: account,
        results: filtered.map(event => normalizeCalendarEvent(event, account, calendarId, includeDescription)),
    }
}

function parseMicrosoftEventDateTime(value = {}) {
    const dateTime = safeTrim(value.dateTime)
    if (!dateTime) return null

    const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(dateTime)
    const parsed = hasOffset
        ? moment.parseZone(dateTime)
        : safeTrim(value.timeZone).toUpperCase() === 'UTC'
        ? moment.utc(dateTime)
        : moment(dateTime)
    return parsed.isValid() ? parsed.valueOf() : null
}

function isMicrosoftMultiDayEvent(startMs, endMs, timeZone) {
    const resolvedTimeZone = moment.tz.zone(timeZone) ? timeZone : 'UTC'
    return (
        moment(startMs).tz(resolvedTimeZone).format('YYYY-MM-DD') !==
        moment(endMs).tz(resolvedTimeZone).format('YYYY-MM-DD')
    )
}

function normalizeMicrosoftGraphNextLink(nextLink = '') {
    const normalized = safeTrim(nextLink)
    if (!normalized) return ''
    let path = normalized

    if (normalized.startsWith('/v1.0/')) {
        path = normalized.substring('/v1.0'.length)
    } else if (!normalized.startsWith('/')) {
        try {
            const parsed = new URL(normalized)
            if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.pathname.startsWith('/v1.0/')) return ''
            path = `${parsed.pathname.substring('/v1.0'.length)}${parsed.search}`
        } catch (_) {
            return ''
        }
    }

    return /^\/me\/calendarView(?:\?|$)/.test(path) ? path : ''
}

async function getMicrosoftBusyIntervalsForConnectedAccount({ userId, account, timeMin, timeMax, timeZone }) {
    const client = await getMicrosoftGraphClient(userId, account.projectId, 'calendar')
    const busyIntervals = []
    const seenPaths = new Set()
    let pageCount = 0
    let path = `/me/calendarView${buildQuery({
        startDateTime: timeMin,
        endDateTime: timeMax,
        $top: 1000,
        $orderby: 'start/dateTime',
        $select: 'start,end,showAs,isCancelled,isAllDay',
    })}`

    while (path) {
        pageCount += 1
        if (pageCount > MAX_AVAILABILITY_PAGES_PER_CALENDAR) {
            throw new Error('Microsoft Calendar availability exceeded the page limit.')
        }
        if (seenPaths.has(path)) throw new Error('Microsoft Calendar pagination loop detected.')
        seenPaths.add(path)

        const response = await client.request(path, { headers: { Prefer: 'outlook.timezone="UTC"' } })
        busyIntervals.push(
            ...(Array.isArray(response?.value) ? response.value : [])
                .filter(event => {
                    return !event?.isCancelled && String(event?.showAs || '').toLowerCase() !== 'free'
                })
                .map(event => {
                    if (event?.isAllDay) return null

                    const startMs = parseMicrosoftEventDateTime(event.start)
                    const endMs = parseMicrosoftEventDateTime(event.end)
                    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
                        throw new Error('Microsoft Calendar returned invalid busy-event timing.')
                    }
                    if (isMicrosoftMultiDayEvent(startMs, endMs, timeZone)) return null
                    return { startMs, endMs }
                })
                .filter(Boolean)
        )

        const nextLink = safeTrim(response?.['@odata.nextLink'])
        path = normalizeMicrosoftGraphNextLink(nextLink)
        if (nextLink && !path) throw new Error('Microsoft Calendar returned an invalid pagination link.')
    }

    return busyIntervals
}

async function getMicrosoftCalendarBusyIntervalsForAssistantRequest({ userId, timeMin, timeMax, timeZone }) {
    const accounts = await getConnectedMicrosoftCalendarAccounts(userId)
    const settledResults = await settleAll(
        accounts.map(account =>
            getMicrosoftBusyIntervalsForConnectedAccount({
                userId,
                account,
                timeMin,
                timeMax,
                timeZone,
            })
        )
    )

    const busyIntervals = []
    let searchedCalendarCount = 0
    let failedCalendarCount = 0
    settledResults.forEach(entry => {
        if (entry.status === 'fulfilled') {
            searchedCalendarCount += 1
            busyIntervals.push(...entry.value)
        } else {
            failedCalendarCount += 1
        }
    })

    return {
        busyIntervals,
        searchedCalendarCount,
        failedCalendarCount,
    }
}

async function searchMicrosoftCalendarEventsForAssistantRequest({
    userId,
    query = '',
    timeMin,
    timeMax,
    calendarId,
    limit = DEFAULT_SEARCH_LIMIT,
    includeDescription = true,
}) {
    const trimmedQuery = safeTrim(query)
    const normalizedLimit = normalizeLimit(limit)
    const accounts = await getConnectedMicrosoftCalendarAccounts(userId)
    if (accounts.length === 0) {
        return {
            success: false,
            query: trimmedQuery,
            searchedAccounts: [],
            accountsWithErrors: [],
            partialFailure: false,
            results: [],
            message:
                'No connected Microsoft Calendar accounts were found for this user. Please connect Calendar first.',
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

    const settledResults = await Promise.allSettled(
        accounts.map(account =>
            searchConnectedAccount({
                userId,
                account,
                query: trimmedQuery,
                timeMin,
                timeMax,
                calendarId: calendarId || DEFAULT_CALENDAR_ID,
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
        } else {
            accountsWithErrors.push({
                projectId: account.projectId,
                calendarEmail: account.calendarEmail,
                error: entry.reason?.message || 'Unknown Microsoft Calendar search error',
            })
        }
    })

    return {
        success: searchedAccounts.length > 0,
        query: trimmedQuery,
        searchedAccounts,
        accountsWithErrors,
        partialFailure: accountsWithErrors.length > 0 && searchedAccounts.length > 0,
        results: mergedResults.slice(0, normalizedLimit),
        message:
            searchedAccounts.length === 0
                ? 'Microsoft Calendar search failed for all connected accounts. Please reconnect Calendar and try again.'
                : mergedResults.length > 0
                ? null
                : 'No matching calendar events were found in the connected Microsoft accounts.',
    }
}

async function resolveAccountForWrite(userId, calendarId) {
    const accounts = await getConnectedMicrosoftCalendarAccounts(userId)
    if (accounts.length === 0) {
        return {
            success: false,
            code: 'calendar_not_connected',
            accounts,
            message: 'No connected Microsoft Calendar accounts were found.',
        }
    }
    if (accounts.length === 1)
        return { success: true, account: accounts[0], calendarId: calendarId || DEFAULT_CALENDAR_ID, accounts }
    const defaultAccount = accounts.find(account => account.calendarDefault)
    if (defaultAccount)
        return { success: true, account: defaultAccount, calendarId: calendarId || DEFAULT_CALENDAR_ID, accounts }
    return {
        success: false,
        code: 'calendar_account_ambiguous',
        accounts,
        message: 'Multiple Calendar accounts are connected. Set a default Calendar account first.',
    }
}

async function createMicrosoftCalendarEventForAssistantRequest(args) {
    const summary = safeTrim(args.summary)
    if (!summary) return { success: false, message: 'A calendar event summary is required.' }

    const resolution = await resolveAccountForWrite(args.userId, args.calendarId)
    if (!resolution.success) return { success: false, ...resolution }

    const payload = buildEventPayload({ ...args, summary }, { requireRange: true })
    const client = await getMicrosoftGraphClient(args.userId, resolution.account.projectId, 'calendar')
    const event = await client.request('/me/events', { method: 'POST', body: JSON.stringify(payload) })
    return {
        success: true,
        provider: 'microsoft',
        calendarEmail: resolution.account.calendarEmail,
        projectId: resolution.account.projectId,
        calendarId: resolution.calendarId,
        event: normalizeCalendarEvent(event, resolution.account, resolution.calendarId, true),
        message: 'Calendar event created successfully.',
    }
}

async function findEventAccount(userId, eventId, calendarId) {
    const accounts = await getConnectedMicrosoftCalendarAccounts(userId)
    for (const account of accounts) {
        try {
            const client = await getMicrosoftGraphClient(userId, account.projectId, 'calendar')
            const event = await client.request(`/me/events/${encodePath(eventId)}`)
            return { success: true, account, event, calendarId: calendarId || DEFAULT_CALENDAR_ID, accounts }
        } catch (error) {
            if (
                String(error?.message || '')
                    .toLowerCase()
                    .includes('not found')
            )
                continue
            throw error
        }
    }
    return {
        success: false,
        code: 'calendar_event_not_found',
        accounts,
        message: `Event "${eventId}" was not found in the connected calendars.`,
    }
}

async function updateMicrosoftCalendarEventForAssistantRequest(args) {
    const eventId = safeTrim(args.eventId)
    if (!eventId) return { success: false, message: 'An eventId is required to update a calendar event.' }
    const resolution = await findEventAccount(args.userId, eventId, args.calendarId)
    if (!resolution.success) return { success: false, ...resolution }

    const payload = buildEventPayload(args, { requireRange: false })
    if (Object.keys(payload).length === 0)
        return { success: false, message: 'No calendar event changes were provided.' }
    const client = await getMicrosoftGraphClient(args.userId, resolution.account.projectId, 'calendar')
    const event = await client.request(`/me/events/${encodePath(eventId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    })
    return {
        success: true,
        provider: 'microsoft',
        calendarEmail: resolution.account.calendarEmail,
        projectId: resolution.account.projectId,
        calendarId: resolution.calendarId,
        event: normalizeCalendarEvent(
            event || { ...resolution.event, ...payload },
            resolution.account,
            resolution.calendarId,
            true
        ),
        message: 'Calendar event updated successfully.',
    }
}

async function deleteMicrosoftCalendarEventForAssistantRequest({ userId, eventId, calendarId }) {
    const trimmedEventId = safeTrim(eventId)
    if (!trimmedEventId) return { success: false, message: 'An eventId is required to delete a calendar event.' }
    const resolution = await findEventAccount(userId, trimmedEventId, calendarId)
    if (!resolution.success) return { success: false, ...resolution }
    const client = await getMicrosoftGraphClient(userId, resolution.account.projectId, 'calendar')
    await client.request(`/me/events/${encodePath(trimmedEventId)}`, { method: 'DELETE' })
    return {
        success: true,
        provider: 'microsoft',
        calendarEmail: resolution.account.calendarEmail,
        projectId: resolution.account.projectId,
        calendarId: resolution.calendarId,
        eventId: trimmedEventId,
        message: 'Calendar event deleted successfully.',
    }
}

module.exports = {
    createMicrosoftCalendarEventForAssistantRequest,
    deleteMicrosoftCalendarEventForAssistantRequest,
    getMicrosoftCalendarBusyIntervalsForAssistantRequest,
    getConnectedMicrosoftCalendarAccounts,
    normalizeCalendarEvent,
    searchMicrosoftCalendarEventsForAssistantRequest,
    updateMicrosoftCalendarEventForAssistantRequest,
}
