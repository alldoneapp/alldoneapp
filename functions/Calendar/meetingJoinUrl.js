'use strict'

// Extracts the one-click "join" URL from a calendar event.
//
// Both calendar providers are normalized to the Google event shape before they
// reach here (see GoogleCalendar/assistantCalendarTools.js normalizeCalendarEvent
// and Calendar/providers/microsoftCalendarProvider.js normalizeCalendarEvent), so
// this works for Google and Microsoft alike:
//
//   1. hangoutLink                      — Google Meet, always the canonical link
//   2. conferenceData.entryPoints[]     — Google, any conferencing add-on (Zoom…)
//   3. conferenceData.joinUrl           — Microsoft (Graph onlineMeeting)
//   4. location                         — organizers often paste the link here
//   5. description                      — last resort; HTML, so entities are decoded
//
// Steps 4–5 scan free text for a URL whose HOST belongs to a known conferencing
// provider. Matching on host rather than on per-provider URL patterns is what
// makes vanity Zoom domains (acme.zoom.us) and regional Webex sites
// (acme.webex.com) work without enumerating them.
//
// Deliberately lives server-side: Anna only ever sees the extracted URL, so a
// provider that changes its link format is a function deploy, not an app release.

// Host suffixes are matched against the full hostname, so `zoom.us` matches
// `acme.zoom.us` but never `notzoom.us`.
const PROVIDER_HOSTS = [
    { provider: 'google_meet', hosts: ['meet.google.com'] },
    { provider: 'zoom', hosts: ['zoom.us', 'zoomgov.com'] },
    { provider: 'teams', hosts: ['teams.microsoft.com', 'teams.live.com'] },
    { provider: 'webex', hosts: ['webex.com', 'webex.com.cn'] },
    { provider: 'whereby', hosts: ['whereby.com'] },
    { provider: 'gotomeeting', hosts: ['gotomeeting.com', 'gotomeet.me', 'goto.com'] },
    { provider: 'bluejeans', hosts: ['bluejeans.com'] },
    { provider: 'chime', hosts: ['chime.aws'] },
    { provider: 'jitsi', hosts: ['meet.jit.si'] },
    { provider: 'ringcentral', hosts: ['ringcentral.com'] },
    { provider: 'slack', hosts: ['app.slack.com'] },
]

// Descriptions can be long; cap the scan so a pathological event cannot burn
// request time on regex work.
const MAX_TEXT_SCAN_LENGTH = 20000

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`\\]+/gi

function safeString(value) {
    return typeof value === 'string' ? value : ''
}

// Google event descriptions are HTML. Decode the entities that actually appear
// in meeting links — `&amp;` must go last so `&amp;lt;` decodes to `&lt;` and
// not to `<`.
function decodeHtmlEntities(text) {
    return safeString(text)
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&#0*39;/g, "'")
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
}

function countOccurrences(text, character) {
    let count = 0
    for (let index = 0; index < text.length; index++) {
        if (text[index] === character) count += 1
    }
    return count
}

// URLs pasted into prose pick up trailing punctuation and wrapping brackets.
// Closing brackets are only stripped when unbalanced, because Teams join URLs
// legitimately contain them inside their percent-encoded context blob.
function trimUrlPunctuation(url) {
    let result = url
    let changed = true

    while (changed && result.length > 0) {
        changed = false

        while (result.length > 0 && '.,;:!?'.includes(result[result.length - 1])) {
            result = result.slice(0, -1)
            changed = true
        }
        const lastCharacter = result[result.length - 1]
        const openingFor = { ')': '(', ']': '[', '}': '{' }[lastCharacter]
        if (openingFor && countOccurrences(result, lastCharacter) > countOccurrences(result, openingFor)) {
            result = result.slice(0, -1)
            changed = true
        }
    }

    return result
}

function hostMatches(hostname, suffix) {
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
}

// The conferencing provider behind a URL, or '' when it is not a meeting link.
function providerForUrl(url) {
    let hostname
    try {
        hostname = new URL(url).hostname.toLowerCase()
    } catch (error) {
        return ''
    }

    const match = PROVIDER_HOSTS.find(entry => entry.hosts.some(suffix => hostMatches(hostname, suffix)))
    return match ? match.provider : ''
}

// A conferencing URL is only usable if it is one we recognise — an arbitrary
// link in a description (an agenda doc, a ticket) must never become the Join
// button's target.
function asJoinLink(url, source) {
    const trimmed = trimUrlPunctuation(safeString(url).trim())
    if (!trimmed) return null
    const provider = providerForUrl(trimmed)
    if (!provider) return null
    return { joinUrl: trimmed, joinProvider: provider, source }
}

function findJoinLinkInText(text, source) {
    const decoded = decodeHtmlEntities(text).slice(0, MAX_TEXT_SCAN_LENGTH)
    if (!decoded) return null

    const matches = decoded.match(URL_IN_TEXT)
    if (!matches) return null

    for (const candidate of matches) {
        const link = asJoinLink(candidate, source)
        if (link) return link
    }
    return null
}

function findJoinLinkInEntryPoints(conferenceData) {
    const entryPoints = Array.isArray(conferenceData?.entryPoints) ? conferenceData.entryPoints : []

    // A video entry point is the one a human clicks; phone/sip entries are dial-in
    // fallbacks and must never win.
    const video = entryPoints.find(entry => entry?.entryPointType === 'video' && entry?.uri)
    if (video) {
        const link = asJoinLink(video.uri, 'conferenceData.entryPoints')
        if (link) return link
    }

    // Some add-ons omit entryPointType entirely; accept any entry whose uri is a
    // recognised provider link.
    for (const entry of entryPoints) {
        const link = asJoinLink(entry?.uri, 'conferenceData.entryPoints')
        if (link) return link
    }
    return null
}

/**
 * Returns `{ joinUrl, joinProvider, source }` for an event, or null when it has
 * no recognisable conferencing link.
 *
 * @param {object} event A normalized calendar event.
 */
function extractMeetingJoinUrl(event = {}) {
    const hangoutLink = asJoinLink(event.hangoutLink, 'hangoutLink')
    if (hangoutLink) return hangoutLink

    const conferenceData = event.conferenceData || null
    if (conferenceData) {
        const fromEntryPoints = findJoinLinkInEntryPoints(conferenceData)
        if (fromEntryPoints) return fromEntryPoints

        // Microsoft: the Graph onlineMeeting object is passed through as
        // conferenceData, and carries a flat joinUrl.
        const fromJoinUrl =
            asJoinLink(conferenceData.joinUrl, 'conferenceData.joinUrl') ||
            asJoinLink(conferenceData.joinWebUrl, 'conferenceData.joinUrl')
        if (fromJoinUrl) return fromJoinUrl
    }

    const fromLocation = findJoinLinkInText(event.location, 'location')
    if (fromLocation) return fromLocation

    return findJoinLinkInText(event.description, 'description')
}

module.exports = {
    extractMeetingJoinUrl,
    __private__: {
        decodeHtmlEntities,
        providerForUrl,
        trimUrlPunctuation,
    },
}
