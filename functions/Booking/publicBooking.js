'use strict'

const crypto = require('crypto')
const admin = require('firebase-admin')
const moment = require('moment-timezone')
const { createCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
const {
    MAX_BOOKING_RANGE_DAYS,
    MAX_PUBLIC_SLOT_OPTIONS,
    findPublicBookingSlots,
    getConnectedCalendarCount,
    getHostingUrl,
    getPublicBookingPage,
    resolveEarliestBookableStart,
    resolvePublicAvailabilityTimeZone,
    resolvePublicDuration,
    slugify,
} = require('./bookingSettings')
const { sendBookingNotificationToHost, sendBookingConfirmationToVisitor } = require('./bookingEmails')
const { consumeBookingQuota, consumeSlotLookupQuota, getClientIp } = require('./bookingRateLimit')
const { withHostBookingLock } = require('./bookingLock')
const { FieldValue } = require('firebase-admin/firestore')

// AT-3161: the public booking page is also an entry point for AI agents. The operations below are
// transport-free ({ status, body }) so the REST routes, the public booking MCP endpoint
// (publicBookingMcp.js) and, through that endpoint, `window.alldone` / WebMCP on the /meet page all
// run the same validation, limits and double-booking protection. None of them needs or accepts an
// Alldone session: they reach exactly what the public web page reaches, nothing more.

// Who made a booking. Only a label for the host (event description, notification mail): a caller
// can claim any of the REST values, so it is never used for access decisions.
const BOOKED_VIA = Object.freeze({
    WEB: 'web',
    API: 'api',
    MCP: 'mcp',
    BROWSER_AGENT: 'browser_agent',
})
const WEB_CLIENT_ID = 'alldone-web'
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/

function setCommonHeaders(res) {
    res.set('Cache-Control', 'no-store')
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    // The MCP endpoint is called cross-origin by browser-based MCP clients, which send the MCP
    // transport headers. There are no credentials on this API, so `*` exposes nothing.
    res.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, X-Alldone-Mcp-Client, Last-Event-ID'
    )
}

function json(res, status, payload) {
    res.status(status).json(payload)
}

function ok(body) {
    return { status: 200, body: { success: true, ...body } }
}

function fail(status, code, error, extra = {}) {
    return { status, body: { success: false, code, error, ...extra } }
}

function getRequestPath(req) {
    const rawPath = req.path || (req.url || '').split('?')[0] || ''
    return rawPath.replace(/^\/api\/booking/, '').replace(/^\/+/, '/')
}

function normalizeEmail(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))
}

function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function parseBody(req) {
    if (req.body && typeof req.body === 'object') return req.body
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body)
        } catch (_) {
            return {}
        }
    }
    return {}
}

function isValidIsoDateTime(value) {
    return typeof value === 'string' && moment.parseZone(value, moment.ISO_8601, true).isValid()
}

function normalizeSlotKey(value, timeZone) {
    const parsed = moment.parseZone(value)
    if (!parsed.isValid()) return ''
    return parsed
        .clone()
        .tz(timeZone || 'UTC')
        .format()
}

function slotMatchesOption(option, start, end, timeZone) {
    return (
        normalizeSlotKey(option.start, timeZone) === normalizeSlotKey(start, timeZone) &&
        normalizeSlotKey(option.end, timeZone) === normalizeSlotKey(end, timeZone)
    )
}

function getBookingUrl(slug) {
    return `${getHostingUrl().replace(/\/+$/, '')}/meet/${slug}`
}

async function loadPublicPage(slug) {
    const page = await getPublicBookingPage(slug)
    const connectedCalendarCount = page ? await getConnectedCalendarCount(page.userId) : 0
    if (!page || connectedCalendarCount === 0) return null
    return page
}

const notFound = () => fail(404, 'not_found', 'Booking page not found')

// A display timezone is optional; an unknown one is refused rather than silently ignored, so an
// agent never presents host-zone times as if they were in its user's zone.
function validateDisplayTimeZone(timeZone) {
    if (timeZone && !moment.tz.zone(timeZone)) {
        return fail(400, 'invalid_timezone', `Unknown IANA timezone "${timeZone}".`)
    }
    return null
}

// The web page only ever offers the page's durations. An API caller that asks for another one
// used to get the default silently, which an agent would then report as the wrong length.
function validateDuration(settings, durationMinutes) {
    if (durationMinutes === undefined || durationMinutes === null || durationMinutes === '') return null
    const available = Array.isArray(settings.availableDurations) ? settings.availableDurations : []
    const requested = parseInt(durationMinutes, 10)
    if (available.length > 0 && !available.includes(requested)) {
        return fail(400, 'invalid_duration', `durationMinutes must be one of: ${available.join(', ')}`, {
            availableDurations: available,
        })
    }
    return null
}

function buildPublicPage(page) {
    return {
        slug: page.slug,
        bookingUrl: getBookingUrl(page.slug),
        profile: page.profile,
        settings: {
            durationMinutes: page.settings.durationMinutes,
            availableDurations: page.settings.availableDurations,
            slotIntervalMinutes: page.settings.slotIntervalMinutes,
            workingHoursStart: page.settings.workingHoursStart,
            workingHoursEnd: page.settings.workingHoursEnd,
            includeWeekends: page.settings.includeWeekends,
            // Drives which days the visitor is offered at all. Enforcement still lives
            // server-side in findPublicBookingSlots — this is only so the page doesn't
            // render a day it would then show as empty.
            allowSameDayBooking: page.settings.allowSameDayBooking === true,
            bufferBeforeMinutes: page.settings.bufferBeforeMinutes,
            bufferAfterMinutes: page.settings.bufferAfterMinutes,
            timeZone: page.settings.timeZone,
        },
        // What a caller may ask for in one availability request (AT-3161).
        limits: {
            maxRangeDays: MAX_BOOKING_RANGE_DAYS,
            maxOptionsPerRequest: MAX_PUBLIC_SLOT_OPTIONS,
        },
    }
}

async function getPublicBookingPageInfo(slug) {
    const page = await loadPublicPage(slug)
    if (!page) return notFound()
    return ok({ page: buildPublicPage(page) })
}

function toDisplayOption(option, displayTimeZone) {
    if (!displayTimeZone) return option
    return {
        ...option,
        displayStart: moment.parseZone(option.start).tz(displayTimeZone).format(),
        displayEnd: moment.parseZone(option.end).tz(displayTimeZone).format(),
    }
}

async function findPublicSlots({ slug: rawSlug, start, end, timeZone, durationMinutes, ip }) {
    const slug = slugify(rawSlug)
    const startText = safeTrim(start)
    const endText = safeTrim(end)
    const displayTimeZoneInput = safeTrim(timeZone)

    if (!slug || !isValidIsoDateTime(startText) || !isValidIsoDateTime(endText)) {
        return fail(400, 'invalid_request', 'slug, start, and end are required (ISO 8601 with offset)')
    }
    const rangeStart = moment.parseZone(startText)
    const rangeEnd = moment.parseZone(endText)
    if (!rangeEnd.isAfter(rangeStart)) return fail(400, 'invalid_request', 'end must be after start')
    // The constant existed but was never enforced here; the engine's own cap returned a 409 that
    // read like a calendar failure. Every range lookup reads the host's calendars, so say it plainly.
    if (rangeEnd.diff(rangeStart, 'days', true) > MAX_BOOKING_RANGE_DAYS) {
        return fail(400, 'range_too_long', `Availability searches are limited to ${MAX_BOOKING_RANGE_DAYS} days.`)
    }
    const timeZoneError = validateDisplayTimeZone(displayTimeZoneInput)
    if (timeZoneError) return timeZoneError

    const page = await loadPublicPage(slug)
    if (!page) return notFound()
    const durationError = validateDuration(page.settings, durationMinutes)
    if (durationError) return durationError

    const quota = await consumeSlotLookupQuota(admin.firestore(), { ip, pageUserId: page.userId, slug })
    if (!quota.allowed) {
        return fail(429, 'rate_limited', 'Too many availability requests. Please try again later.')
    }

    const slotsResult = await findPublicBookingSlots(page, {
        start: startText,
        end: endText,
        timeZone: displayTimeZoneInput,
        durationMinutes,
    })
    if (!slotsResult.success) {
        return fail(409, 'calendar_unavailable', slotsResult.message || 'Calendar availability could not be checked', {
            options: [],
        })
    }

    const hostTimeZone = slotsResult.timeZone
    const displayTimeZone = displayTimeZoneInput && displayTimeZoneInput !== hostTimeZone ? displayTimeZoneInput : null
    const options = (slotsResult.options || []).map(option => toDisplayOption(option, displayTimeZone))
    const truncated = options.length >= MAX_PUBLIC_SLOT_OPTIONS
    return ok({
        // Options are in the host's timezone (with offset, so unambiguous); displayStart/displayEnd
        // carry the same instant in the requested timeZone when it differs.
        timeZone: hostTimeZone,
        ...(displayTimeZone ? { displayTimeZone } : {}),
        durationMinutes: slotsResult.durationMinutes,
        options,
        truncated,
        ...(truncated ? { nextSearchStart: options[options.length - 1].end } : {}),
    })
}

const BOOKED_VIA_DESCRIPTIONS = {
    [BOOKED_VIA.API]: 'Booked through the public booking API (possibly by an AI agent).',
    [BOOKED_VIA.MCP]: 'Booked by an AI agent through the public booking MCP endpoint.',
    [BOOKED_VIA.BROWSER_AGENT]: 'Booked by an AI agent on the booking page (window.alldone / WebMCP).',
}

function describeBookedVia(bookedVia) {
    return BOOKED_VIA_DESCRIPTIONS[bookedVia] || ''
}

function buildBookingDescription({ visitorName, visitorEmail, note, slug, bookedVia }) {
    const lines = [
        `Booked from Alldone.app public booking link: ${getBookingUrl(slug)}`,
        `Visitor: ${visitorName} <${visitorEmail}>`,
    ]
    const via = describeBookedVia(bookedVia)
    if (via) lines.push(via)
    if (safeTrim(note)) {
        lines.push('', 'Note:', safeTrim(note))
    }
    return lines.join('\n')
}

function requestedRangeMatchesDuration({ start, end, durationMinutes }) {
    const startMoment = moment.parseZone(start)
    const endMoment = moment.parseZone(end)
    return endMoment.diff(startMoment, 'minutes') === durationMinutes
}

async function assertSlotStillAvailable(page, { start, end, durationMinutes }) {
    const slotStart = moment.parseZone(start)
    const resolvedDurationMinutes = resolvePublicDuration(page.settings, durationMinutes)
    if (!requestedRangeMatchesDuration({ start, end, durationMinutes: resolvedDurationMinutes })) return false
    const hostTimeZone = resolvePublicAvailabilityTimeZone(page.settings)
    const rangeStart = slotStart.clone().tz(hostTimeZone).startOf('day').format()
    const rangeEnd = slotStart.clone().tz(hostTimeZone).endOf('day').format()
    const result = await findPublicBookingSlots(page, {
        start: rangeStart,
        end: rangeEnd,
        timeZone: hostTimeZone,
        durationMinutes: resolvedDurationMinutes,
    })
    return (
        result.success && (result.options || []).some(option => slotMatchesOption(option, start, end, result.timeZone))
    )
}

const bookingsCollection = (db, userId) => db.collection(`users/${userId}/bookings`)

// AT-3161: a booking that this endpoint stored a moment ago blocks its time (plus the host's
// buffers), even if the calendar's free/busy answer does not show the new event yet. Only recent
// bookings count: the calendar is the truth once it has caught up, and a host who deletes a booked
// event there must get the slot back (bookings are not synced back from the calendar).
const STORED_BOOKING_LAG_WINDOW_MS = 15 * 60 * 1000

async function hasStoredBookingConflict(db, page, { startMs, endMs, nowMs }) {
    const bufferBeforeMs = (Number(page.settings.bufferBeforeMinutes) || 0) * 60000
    const bufferAfterMs = (Number(page.settings.bufferAfterMinutes) || 0) * 60000
    const snapshot = await bookingsCollection(db, page.userId)
        .where('endMs', '>', startMs - bufferAfterMs)
        .limit(500)
        .get()
    return snapshot.docs.some(doc => {
        const booking = doc.data() || {}
        return (
            booking.status === 'confirmed' &&
            Number(booking.createdAtMs) > nowMs - STORED_BOOKING_LAG_WINDOW_MS &&
            Number(booking.startMs) < endMs + bufferBeforeMs
        )
    })
}

const hashIdempotencyKey = (slug, key) =>
    crypto.createHash('sha256').update(`booking-idempotency:${slug}:${key}`).digest('hex')

async function findIdempotentBooking(db, page, idempotencyKeyHash) {
    if (!idempotencyKeyHash) return null
    const snapshot = await bookingsCollection(db, page.userId)
        .where('idempotencyKeyHash', '==', idempotencyKeyHash)
        .limit(1)
        .get()
    const doc = snapshot.docs[0]
    return doc ? { id: doc.id, ...(doc.data() || {}) } : null
}

// A retry with the same key returns the first answer, without a second event, mail or quota. The
// key is the caller's secret, so the replay may include the join link the first answer had.
function replayBooking(existing, { startMs, endMs, visitorEmail }) {
    if (
        Number(existing.startMs) !== startMs ||
        Number(existing.endMs) !== endMs ||
        normalizeEmail(existing.visitorEmail) !== visitorEmail
    ) {
        return fail(
            409,
            'idempotency_conflict',
            'This idempotencyKey was already used for a different booking. Use a new key for a new booking.'
        )
    }
    return ok({
        bookingId: existing.id,
        status: existing.status || 'confirmed',
        start: existing.start,
        end: existing.end,
        durationMinutes: existing.durationMinutes,
        timeZone: existing.timeZone || '',
        joinUrl: existing.event?.joinUrl || '',
        idempotentReplay: true,
    })
}

async function bookPublicMeeting({
    slug: rawSlug,
    start: rawStart,
    end: rawEnd,
    timeZone: rawTimeZone,
    durationMinutes,
    visitorName: rawVisitorName,
    visitorEmail: rawVisitorEmail,
    note: rawNote,
    idempotencyKey: rawIdempotencyKey,
    ip,
    bookedVia = BOOKED_VIA.API,
    now = Date.now,
    // Tests only: how long to wait for a concurrent booking of the same host.
    lockOptions = undefined,
}) {
    const slug = slugify(rawSlug)
    const start = safeTrim(rawStart)
    const end = safeTrim(rawEnd)
    const visitorTimeZoneInput = safeTrim(rawTimeZone)
    const visitorName = safeTrim(rawVisitorName).slice(0, 120)
    const visitorEmail = normalizeEmail(rawVisitorEmail)
    const note = safeTrim(rawNote).slice(0, 2000)
    const idempotencyKey = safeTrim(rawIdempotencyKey)

    if (!slug || !isValidIsoDateTime(start) || !isValidIsoDateTime(end)) {
        return fail(400, 'invalid_request', 'slug, start, and end are required (ISO 8601 with offset)')
    }
    if (!visitorName || !isValidEmail(visitorEmail)) {
        return fail(400, 'invalid_visitor', 'Visitor name and a valid email are required')
    }
    if (!moment.parseZone(end).isAfter(moment.parseZone(start))) {
        return fail(400, 'invalid_request', 'end must be after start')
    }
    if (idempotencyKey && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        return fail(400, 'invalid_request', 'idempotencyKey must be 8-200 characters of A-Z, a-z, 0-9, . _ : -')
    }
    const timeZoneError = validateDisplayTimeZone(visitorTimeZoneInput)
    if (timeZoneError) return timeZoneError

    const page = await loadPublicPage(slug)
    if (!page) return notFound()
    const durationError = validateDuration(page.settings, durationMinutes)
    if (durationError) return durationError

    const startMs = moment.parseZone(start).valueOf()
    const endMs = moment.parseZone(end).valueOf()
    const hostTimeZone = resolvePublicAvailabilityTimeZone(page.settings)
    const visitorTimeZone = visitorTimeZoneInput || hostTimeZone
    const db = admin.firestore()
    const idempotencyKeyHash = idempotencyKey ? hashIdempotencyKey(slug, idempotencyKey) : ''

    // A finished booking replayed with its key is answered before any limit is spent.
    const earlierBooking = await findIdempotentBooking(db, page, idempotencyKeyHash)
    if (earlierBooking) return replayBooking(earlierBooking, { startMs, endMs, visitorEmail })

    if (startMs <= now()) {
        return fail(409, 'slot_in_past', 'This time is in the past. Ask for available times again.')
    }

    // findPublicBookingSlots already refuses to return same-day options, so the availability
    // re-check below would reject this anyway — but with a misleading "no longer available".
    // Check it up front so a direct API caller gets told the actual reason.
    const earliestBookableStart = resolveEarliestBookableStart(page.settings, visitorTimeZoneInput)
    if (earliestBookableStart && moment.parseZone(start).isBefore(earliestBookableStart)) {
        return fail(409, 'same_day_not_allowed', 'Same-day bookings are not available for this link')
    }

    // Security audit 2026-11 (#10): every accepted booking mails an address the caller chose, so the
    // endpoint is rate limited per IP, per page and per recipient before anything else happens.
    const quota = await consumeBookingQuota(db, {
        ip,
        pageUserId: page.userId,
        slug,
        recipientEmail: visitorEmail,
    })
    if (!quota.allowed) {
        return fail(429, 'rate_limited', 'Too many bookings. Please try again later.')
    }

    const resolvedDurationMinutes = resolvePublicDuration(page.settings, durationMinutes)

    const locked = await withHostBookingLock(
        db,
        page.userId,
        async () => {
            // A duplicate that waited for the lock while the first request was still running.
            const concurrentBooking = await findIdempotentBooking(db, page, idempotencyKeyHash)
            if (concurrentBooking)
                return { response: replayBooking(concurrentBooking, { startMs, endMs, visitorEmail }) }

            const available = await assertSlotStillAvailable(page, {
                start,
                end,
                durationMinutes: resolvedDurationMinutes,
            })
            if (!available || (await hasStoredBookingConflict(db, page, { startMs, endMs, nowMs: now() }))) {
                return {
                    response: fail(
                        409,
                        'slot_unavailable',
                        'This slot is no longer available. Ask for available times again and pick another one.'
                    ),
                }
            }

            // Host-configured fixed guests (block a shared calendar, auto-invite colleagues).
            // Skip any that duplicate the visitor so the booker isn't added twice.
            const additionalGuestEmails = Array.isArray(page.settings.additionalGuestEmails)
                ? page.settings.additionalGuestEmails
                : []
            const attendees = [{ email: visitorEmail, displayName: visitorName }]
            additionalGuestEmails.forEach(guestEmail => {
                if (guestEmail && guestEmail !== visitorEmail) attendees.push({ email: guestEmail })
            })

            const eventResult = await createCalendarEventForAssistantRequest({
                userId: page.userId,
                summary: `Meeting with ${visitorName}`,
                description: buildBookingDescription({ visitorName, visitorEmail, note, slug, bookedVia }),
                start,
                end,
                timeZone: hostTimeZone,
                attendees,
            })

            if (!eventResult?.success) {
                return {
                    response: fail(
                        409,
                        'calendar_unavailable',
                        eventResult?.message || 'Calendar event could not be created'
                    ),
                }
            }

            const bookingRef = bookingsCollection(db, page.userId).doc()
            await bookingRef.set({
                slug,
                status: 'confirmed',
                visitorName,
                visitorEmail,
                note,
                start,
                end,
                startMs,
                endMs,
                createdAtMs: now(),
                durationMinutes: resolvedDurationMinutes,
                timeZone: hostTimeZone,
                visitorTimeZone,
                bookedVia,
                ...(idempotencyKeyHash ? { idempotencyKeyHash } : {}),
                event: {
                    provider: eventResult.provider || 'google',
                    calendarId: eventResult.calendarId || '',
                    eventId: eventResult.event?.eventId || '',
                    htmlLink: eventResult.event?.htmlLink || '',
                    // Empty when the calendar provider refused to create a conference —
                    // the booking still stands, it just has no one-click join link.
                    joinUrl: eventResult.joinUrl || '',
                    joinProvider: eventResult.joinProvider || '',
                },
                createdAt: FieldValue.serverTimestamp(),
            })
            return { bookingId: bookingRef.id, eventResult }
        },
        lockOptions
    )

    if (!locked.acquired) {
        return fail(
            409,
            'busy',
            'Another booking for this page is being processed. Wait a few seconds and try again (reuse your idempotencyKey).'
        )
    }
    if (locked.result.response) return locked.result.response

    const { bookingId, eventResult } = locked.result
    const joinUrl = eventResult.joinUrl || ''

    // Notify both sides — the host that somebody booked, and the visitor that it's
    // confirmed. Both fail soft so a mail issue never breaks the confirmed booking.
    const hostName = safeTrim(page.profile?.displayName)
    await Promise.all([
        sendBookingNotificationToHost({
            userId: page.userId,
            visitorName,
            visitorEmail,
            note,
            start,
            end,
            timeZone: hostTimeZone,
            durationMinutes: resolvedDurationMinutes,
            eventHtmlLink: eventResult.event?.htmlLink || '',
            joinUrl,
            bookedViaText: describeBookedVia(bookedVia),
        }),
        sendBookingConfirmationToVisitor({
            visitorName,
            visitorEmail,
            hostName,
            note,
            start,
            end,
            timeZone: visitorTimeZone,
            durationMinutes: resolvedDurationMinutes,
            joinUrl,
        }),
    ])

    return ok({
        bookingId,
        status: 'confirmed',
        start,
        end,
        durationMinutes: resolvedDurationMinutes,
        timeZone: hostTimeZone,
        joinUrl,
    })
}

function resolveRestBookedVia(body) {
    return safeTrim(body.client) === WEB_CLIENT_ID ? BOOKED_VIA.WEB : BOOKED_VIA.API
}

function send(res, result) {
    json(res, result.status, result.body)
}

async function bookingApiHandler(req, res) {
    setCommonHeaders(res)
    if (req.method === 'OPTIONS') {
        res.status(204).send('')
        return
    }

    try {
        const path = getRequestPath(req)
        const pageMatch = path.match(/^\/page\/(?<slug>[a-zA-Z0-9-]+)$/)
        if (req.method === 'GET' && pageMatch) {
            send(res, await getPublicBookingPageInfo(pageMatch.groups.slug))
            return
        }
        if (req.method === 'GET' && path === '/slots') {
            send(
                res,
                await findPublicSlots({
                    slug: req.query?.slug,
                    start: req.query?.start,
                    end: req.query?.end,
                    timeZone: req.query?.timeZone,
                    durationMinutes: req.query?.durationMinutes,
                    ip: getClientIp(req),
                })
            )
            return
        }
        if (req.method === 'POST' && path === '/book') {
            const body = parseBody(req)
            send(
                res,
                await bookPublicMeeting({
                    slug: body.slug,
                    start: body.start,
                    end: body.end,
                    timeZone: body.timeZone,
                    durationMinutes: body.durationMinutes,
                    visitorName: body.visitorName,
                    visitorEmail: body.visitorEmail,
                    note: body.note,
                    idempotencyKey: body.idempotencyKey,
                    ip: getClientIp(req),
                    bookedVia: resolveRestBookedVia(body),
                })
            )
            return
        }
        // AT-3161: agent entry points. Required lazily so the REST routes above stay as they were.
        const agentMatch = path.match(/^\/agent\/(?<slug>[a-zA-Z0-9-]+)$/)
        const meetLlmsMatch = path.match(/^\/meet\/(?<slug>[a-zA-Z0-9-]+)\/llms\.txt$/)
        if (req.method === 'GET' && (agentMatch || meetLlmsMatch)) {
            const { handleAgentInstructions } = require('./publicBookingAgentDocs')
            await handleAgentInstructions(req, res, (agentMatch || meetLlmsMatch).groups.slug)
            return
        }
        const mcpMatch = path.match(/^\/mcp(?:\/(?<slug>[a-zA-Z0-9-]+))?\/?$/)
        if (mcpMatch) {
            const { handlePublicBookingMcp } = require('./publicBookingMcp')
            await handlePublicBookingMcp(req, res, { boundSlug: mcpMatch.groups?.slug || '' })
            return
        }
        json(res, 404, { success: false, code: 'not_found', error: 'Not found' })
    } catch (error) {
        console.error('bookingApi: error', error)
        json(res, 500, { success: false, code: 'internal', error: 'Internal error' })
    }
}

module.exports = {
    BOOKED_VIA,
    WEB_CLIENT_ID,
    bookPublicMeeting,
    bookingApiHandler,
    buildBookingDescription,
    findPublicSlots,
    getBookingUrl,
    getPublicBookingPageInfo,
    hashIdempotencyKey,
    isValidEmail,
    slotMatchesOption,
}
