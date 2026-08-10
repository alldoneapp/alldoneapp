'use strict'

// Automatic conferencing for events Alldone creates on the user's behalf.
//
// Every meeting Anna books — through the public booking page (/meet/<slug>) and
// through the create_calendar_event assistant tool — should come with a join
// link already attached, so neither the host nor the visitor has to add one
// afterwards. Google calendars get a Google Meet conference, Microsoft calendars
// get a Teams online meeting, because Meet cannot be provisioned on a Graph
// event.
//
// Conferencing is best-effort by design: a booking must never be lost because
// the provider refused to create a conference (Workspace policy can disable
// Meet, a Graph tenant can disable Teams). Callers retry the write without the
// conferencing fields when `isConferencingRejection` says the provider rejected
// the request outright, and simply return an event with no link.
//
// Requires no extra OAuth scope: `calendar.events` already authorizes Meet
// creation, and `Calendars.ReadWrite` already authorizes Teams meetings.

const crypto = require('crypto')

// Google refuses `conferenceData` unless the request also opts in to the
// conferencing-aware version of the events resource.
const GOOGLE_CONFERENCE_DATA_VERSION = 1

const GOOGLE_MEET_SOLUTION_TYPE = 'hangoutsMeet'
const MICROSOFT_TEAMS_PROVIDER = 'teamsForBusiness'

// Status codes Google reports back on the created event. Anything other than
// 'success' means the event exists but carries no usable link.
const GOOGLE_CONFERENCE_SUCCESS_STATUS = 'success'

/**
 * A Google `conferenceData` block that asks Calendar to provision a new Meet.
 *
 * `requestId` must be unique per request: Google treats a repeated id on the
 * same event as a retry of the original conference. (Two legacy browser-side
 * modals in this repo hardcode a constant id — do not copy that.)
 */
function buildGoogleMeetCreateRequest() {
    return {
        createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: GOOGLE_MEET_SOLUTION_TYPE },
        },
    }
}

/**
 * The Graph fields that turn an event into a Teams meeting.
 */
function buildMicrosoftOnlineMeetingFields() {
    return {
        isOnlineMeeting: true,
        onlineMeetingProvider: MICROSOFT_TEAMS_PROVIDER,
    }
}

/**
 * All-day events (`{ date: 'YYYY-MM-DD' }`) are holidays, vacations and
 * reminders rather than meetings, so they never get a conference. Timed events
 * always do.
 */
function isAllDayEventPayload(payload = {}) {
    return !!(payload.start && payload.start.date && !payload.start.dateTime)
}

/**
 * Whether an event Alldone is about to create should get a conference.
 *
 * `addConferencing: false` is an explicit internal opt-out for callers that
 * create non-meeting events; it is deliberately not exposed to the model.
 */
function shouldAddConferencing(payload = {}, addConferencing = true) {
    if (addConferencing === false) return false
    return !isAllDayEventPayload(payload)
}

function readErrorStatus(error) {
    const candidates = [error?.code, error?.status, error?.response?.status, error?.statusCode]
    for (const candidate of candidates) {
        const parsed = parseInt(candidate, 10)
        if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 599) return parsed
    }
    return 0
}

function readErrorMessage(error) {
    return String(error?.response?.data?.error?.message || error?.message || '').toLowerCase()
}

// Wording the providers use when they refuse conferencing specifically. Used to
// recognise a rejection that arrives without a usable HTTP status (the Graph
// client re-throws a plain Error carrying only the message).
const CONFERENCING_REJECTION_HINTS = [
    'conference',
    'hangout',
    'meet',
    'online meeting',
    'onlinemeeting',
    'teams',
    'invalid conference type',
]

/**
 * Whether a failed create should be retried with the conferencing fields
 * stripped.
 *
 * Only definitive client-side rejections (400/403) qualify: those mean the
 * provider validated and refused the request, so nothing was created and a
 * retry cannot duplicate the event. A 5xx or a network error might have
 * succeeded server-side, so those propagate untouched rather than risk booking
 * the same slot twice.
 *
 * @param {Error} error The error thrown by the provider client.
 */
function isConferencingRejection(error) {
    const status = readErrorStatus(error)
    if (status === 400 || status === 403) return true
    // The Graph client throws `new Error(data.error.message)` with no status, so
    // fall back to matching the message when no status is available at all.
    if (status === 0) {
        const message = readErrorMessage(error)
        return CONFERENCING_REJECTION_HINTS.some(hint => message.includes(hint))
    }
    return false
}

/**
 * Whether Google actually provisioned the conference it was asked for. A
 * `createRequest` that ends in 'failure' leaves a perfectly good event with no
 * link, which is the same outcome as a rejected insert.
 */
function googleConferenceSucceeded(event = {}) {
    const statusCode = event?.conferenceData?.createRequest?.status?.statusCode
    if (!statusCode) return !!(event?.hangoutLink || event?.conferenceData?.entryPoints)
    return statusCode === GOOGLE_CONFERENCE_SUCCESS_STATUS
}

module.exports = {
    GOOGLE_CONFERENCE_DATA_VERSION,
    GOOGLE_MEET_SOLUTION_TYPE,
    MICROSOFT_TEAMS_PROVIDER,
    buildGoogleMeetCreateRequest,
    buildMicrosoftOnlineMeetingFields,
    googleConferenceSucceeded,
    isAllDayEventPayload,
    isConferencingRejection,
    shouldAddConferencing,
}
