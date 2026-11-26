'use strict'

// AT-3161 follow-up: someone else's public booking link (/meet/<slug>) as tools of the CONNECTED
// Alldone surfaces (signed-in MCP, `window.alldone` in a signed-in tab, in-app assistants). Schemas
// and names are in publicBookingToolSchemas.js.
//
// Nothing here schedules: the three tools run the operations the public page and the anonymous
// booking MCP run (publicBooking.js: same working hours, buffers, minimum free time, same-day rule,
// duration check, 31-day window, rate limits, host lock, idempotency, mails and conferencing). What
// the connected surface adds is the user it acts for:
//   - name, email and timezone come from the signed-in user unless the call names others;
//   - the host's public slots are matched against the user's OWN calendars (busy timings only,
//     read server-side and never returned), so the agent gets times free for both;
//   - rate limits count per Alldone account instead of per IP (there is no client IP here);
//   - a booking needs confirmedByUser, and an assistant may only book in a turn the user typed
//     (isHumanTurn, the same check as move_task_workflow_step), never from an email, heartbeat or
//     workflow prompt.
// Trust boundary: confirmedByUser is what the AGENT says, not proof that a human agreed. Over MCP the
// server cannot see the conversation; what stands between a model and a booking there is the client's
// own approval of a non-read-only tool call (book_public_meeting is annotated so) and the model
// following the tool description. For an assistant the server additionally knows the turn was typed
// by the user, but not that the user confirmed this exact slot. What the server does guarantee no
// matter what the caller claims: the page's rules, a free slot, one booking per slot and key, and that
// the booking is the caller's own (their account's rate limits, "Booked via" for the host).
// The host sees "Booked via" (BOOKED_VIA.ALLDONE_MCP / ALLDONE_ASSISTANT) like every agent booking.

const crypto = require('crypto')
const moment = require('moment-timezone')
const {
    BOOK_PUBLIC_MEETING,
    FIND_PUBLIC_BOOKING_TIMES,
    GET_PUBLIC_BOOKING_PAGE,
    isPublicBookingToolName,
} = require('./publicBookingToolSchemas')

const DEFAULT_SEARCH_DAYS = 7

const safeTrim = value => (typeof value === 'string' ? value.trim() : '')

const fail = (code, error, extra = {}) => ({ success: false, code, error, message: error, ...extra })

const { resolveBookingSlug } = require('./publicBookingLink')

async function loadVisitorProfile(db, userId) {
    const {
        __private__: { resolveUserIanaTimeZone },
    } = require('../GoogleCalendar/assistantCalendarTools')
    const snapshot = await db.doc(`users/${userId}`).get()
    const data = snapshot.exists ? snapshot.data() || {} : {}
    return {
        name: safeTrim(data.displayName) || safeTrim(data.name),
        email: safeTrim(data.email).toLowerCase(),
        timeZone: resolveUserIanaTimeZone(data) || '',
    }
}

// Rate-limit bucket of the caller: the account, not a header-borne IP (bookingRateLimit.js hashes it).
const callerQuotaKey = userId => `alldone-user:${userId}`

async function getPage(slug, { db, userId }) {
    const { getPublicBookingPageInfo } = require('./publicBooking')
    const { getConnectedCalendarCount, getPublicBookingPage } = require('./bookingSettings')
    const info = await getPublicBookingPageInfo(slug)
    if (!info.body.success) return info.body
    const [profile, calendarCount, pageRecord] = await Promise.all([
        loadVisitorProfile(db, userId),
        getConnectedCalendarCount(userId),
        getPublicBookingPage(slug),
    ])
    const ownPage = pageRecord?.userId === userId
    return {
        ...info.body,
        // Who book_public_meeting books for unless told otherwise: the user's own profile, shown to
        // the user's own agent so it can ask for confirmation without asking for known details.
        you: {
            name: profile.name,
            email: profile.email,
            timeZone: profile.timeZone,
            calendarConnected: calendarCount > 0,
        },
        ...(ownPage ? { ownPage: true } : {}),
        message: ownPage
            ? 'This is the user’s OWN booking link: booking it puts a meeting with themselves into their calendar.'
            : 'Next: find_public_booking_times (reads need no confirmation), propose one slot, then book_public_meeting after the user confirmed exactly that slot.',
    }
}

const overlaps = (busy, startMs, endMs) => busy.startMs < endMs && busy.endMs > startMs

// The host's slots that are also free in the user's own calendars. Busy timings only; nothing of the
// user's calendar leaves this function except which of the HOST's slots survive.
async function matchVisitorCalendar(userId, options, hostTimeZone) {
    if (options.length === 0) return { options, visitorCalendar: { checked: false, reason: 'no_host_slots' } }
    const { loadCalendarBusyIntervalsForUser } = require('../GoogleCalendar/assistantCalendarTools')
    const timeMin = moment.parseZone(options[0].start).toISOString()
    const timeMax = moment.parseZone(options[options.length - 1].end).toISOString()
    let loaded
    try {
        loaded = await loadCalendarBusyIntervalsForUser({ userId, timeMin, timeMax, timeZone: hostTimeZone })
    } catch (error) {
        console.warn('find_public_booking_times: visitor calendar not readable', error?.message)
        loaded = { busyIntervals: [], searchedCalendarCount: 0, failedCalendarCount: 1 }
    }
    if (loaded.failedCalendarCount > 0) {
        return {
            options,
            visitorCalendar: {
                checked: false,
                reason: 'unavailable',
                message:
                    "The user's calendar could not be read completely, so these are the host's free slots only. Check them with the user (or ask them to reconnect their calendar).",
            },
        }
    }
    if (loaded.searchedCalendarCount === 0) {
        return {
            options,
            visitorCalendar: {
                checked: false,
                reason: 'not_connected',
                message:
                    "The user has no calendar connected to Alldone, so these are the host's free slots only. Check them with the user.",
            },
        }
    }
    const free = options.filter(option => {
        const startMs = moment.parseZone(option.start).valueOf()
        const endMs = moment.parseZone(option.end).valueOf()
        return !loaded.busyIntervals.some(busy => overlaps(busy, startMs, endMs))
    })
    return {
        options: free,
        visitorCalendar: {
            checked: true,
            calendarsChecked: loaded.searchedCalendarCount,
            hostSlotsBusyForYou: options.length - free.length,
        },
    }
}

async function findTimes(slug, args, { db, userId }) {
    const { findPublicSlots, getBookingUrl } = require('./publicBooking')
    const profile = await loadVisitorProfile(db, userId)
    const start = safeTrim(args.start) || moment().format()
    const parsedStart = moment.parseZone(start, moment.ISO_8601, true)
    const end =
        safeTrim(args.end) ||
        (parsedStart.isValid() ? parsedStart.clone().add(DEFAULT_SEARCH_DAYS, 'days').format() : '')
    const result = await findPublicSlots({
        slug,
        start,
        end,
        timeZone: safeTrim(args.timeZone) || profile.timeZone,
        durationMinutes: args.durationMinutes,
        ip: callerQuotaKey(userId),
    })
    const body = result.body
    if (!body.success) return { ...body, message: body.error }

    const hostOptions = Array.isArray(body.options) ? body.options : []
    const matched =
        args.matchMyCalendar === false
            ? { options: hostOptions, visitorCalendar: { checked: false, reason: 'not_requested' } }
            : await matchVisitorCalendar(userId, hostOptions, body.timeZone)

    const mutual = matched.visitorCalendar.checked === true
    let message
    if (hostOptions.length === 0) message = 'The host has no free slot in this range. Try a later range.'
    else if (mutual)
        message =
            matched.options.length > 0
                ? `${matched.options.length} of the host's ${hostOptions.length} free slots are also free in the user's calendar. Propose a slot with date, time and time zone (displayStart/displayEnd are in the user's), and book only after the user confirmed exactly that slot.`
                : `None of the host's ${hostOptions.length} free slots is free in the user's calendar. Try a later range, or ask the user whether to look at the host's slots anyway (matchMyCalendar: false).`
    else message = matched.visitorCalendar.message || "These are the host's free slots only."

    return {
        ...body,
        bookingUrl: getBookingUrl(slug),
        availability: mutual ? 'free_for_host_and_user' : 'host_only',
        visitorCalendar: matched.visitorCalendar,
        hostOptionCount: hostOptions.length,
        options: matched.options,
        message,
    }
}

const deriveIdempotencyKey = ({ userId, slug, start, end, visitorEmail }) =>
    `alldone-${crypto
        .createHash('sha256')
        .update(
            `${userId}|${slug}|${moment.parseZone(start).valueOf()}|${moment.parseZone(end).valueOf()}|${visitorEmail}`
        )
        .digest('hex')
        .slice(0, 40)}`

async function book(slug, args, { db, userId, assistantId, runtime }) {
    const { BOOKED_VIA, bookPublicMeeting, getBookingUrl } = require('./publicBooking')
    if (args.confirmedByUser !== true) {
        return fail(
            'confirmation_required',
            'Not booked. Show the user the exact slot (date, time and time zone), the duration, name and email, and call again with confirmedByUser: true only after they confirmed exactly that slot. If they pick another slot, ask again for that one.'
        )
    }
    const viaMcp = runtime?.sourceChannel === 'mcp'
    if (!viaMcp) {
        // An assistant books only when the user asked in a message they typed: never because an email,
        // a web page, a heartbeat or a workflow prompt said so.
        const { isHumanTurn } = require('../Assistant/workflowStepMoveTool')
        if (!(await isHumanTurn(db, runtime, userId))) {
            return fail(
                'confirmation_required',
                'Not booked. An assistant books a meeting only in reply to a message the user typed that confirms the slot. Propose the slot and ask the user.'
            )
        }
    }

    const profile = await loadVisitorProfile(db, userId)
    const visitorName = safeTrim(args.visitorName) || profile.name
    const visitorEmail = (safeTrim(args.visitorEmail) || profile.email).toLowerCase()
    if (!visitorName || !visitorEmail) {
        return fail(
            'invalid_visitor',
            'The user has no name or email in Alldone. Ask the user for the missing detail and pass visitorName / visitorEmail.'
        )
    }
    const start = safeTrim(args.start)
    const end = safeTrim(args.end)
    const idempotencyKey =
        safeTrim(args.idempotencyKey) ||
        (start && end && moment.parseZone(start).isValid() && moment.parseZone(end).isValid()
            ? deriveIdempotencyKey({ userId, slug, start, end, visitorEmail })
            : '')

    const result = await bookPublicMeeting({
        slug,
        start,
        end,
        timeZone: safeTrim(args.timeZone) || profile.timeZone,
        durationMinutes: args.durationMinutes,
        visitorName,
        visitorEmail,
        note: args.note,
        idempotencyKey,
        ip: callerQuotaKey(userId),
        bookedVia: viaMcp || !assistantId ? BOOKED_VIA.ALLDONE_MCP : BOOKED_VIA.ALLDONE_ASSISTANT,
    })
    const body = result.body
    if (!body.success) return { ...body, message: body.error }
    return {
        ...body,
        bookingUrl: getBookingUrl(slug),
        visitorName,
        visitorEmail,
        message: body.idempotentReplay
            ? 'This booking already existed; nothing was booked twice.'
            : `Booked. A confirmation went to ${visitorEmail}; the host was notified.`,
    }
}

/**
 * Runs one of the three tools for `userId` (the signed-in user; for an assistant, the user it acts
 * for). Returns a conversation-safe result object; failures are `success: false` with a `code`.
 */
async function executePublicBookingTool({ toolName, args, db, userId, assistantId = null, runtime = null }) {
    if (!isPublicBookingToolName(toolName)) throw new Error(`Unknown public booking tool: ${toolName}`)
    if (!userId) return fail('no_user', 'There is no Alldone user to book for.')
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
    const resolved = resolveBookingSlug(input.bookingUrl ?? input.url ?? input.slug)
    if (resolved.error) return resolved.error
    const context = { db, userId, assistantId, runtime }
    if (toolName === GET_PUBLIC_BOOKING_PAGE) return getPage(resolved.slug, context)
    if (toolName === FIND_PUBLIC_BOOKING_TIMES) return findTimes(resolved.slug, input, context)
    if (toolName === BOOK_PUBLIC_MEETING) return book(resolved.slug, input, context)
    return fail('unknown_tool', `Unknown public booking tool: ${toolName}`)
}

module.exports = {
    executePublicBookingTool,
    resolveBookingSlug,
    __private__: { deriveIdempotencyKey, matchVisitorCalendar, callerQuotaKey },
}
