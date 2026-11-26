'use strict'

// AT-3161: which links count as a booking link of THIS Alldone environment, and what an agent that
// opened one with the browser tools is told. Dependency-light (no Firestore, no calendar code) so the
// browser tool path can use it without loading the booking stack.

const safeTrim = value => (typeof value === 'string' ? value.trim() : '')

const fail = (code, error, extra = {}) => ({ success: false, code, error, message: error, ...extra })

// Only links of THIS Alldone environment: a slug is looked up in this project's bookingPages, so a
// staging link on production (or a look-alike domain) would silently open a different page.
function getAllowedBookingHosts() {
    const { getHostingUrl } = require('./bookingSettings')
    const hosts = new Set()
    try {
        hosts.add(new URL(getHostingUrl()).host.toLowerCase())
    } catch (_) {}
    if (process.env.FUNCTIONS_EMULATOR) {
        hosts.add('localhost:19006')
        hosts.add('localhost:5000')
    }
    return hosts
}

const BOOKING_PATH = /^\/(?:meet|api\/booking\/mcp)\/([A-Za-z0-9-]{1,60})(?:\/llms\.txt)?\/?$/
const BOOKING_PAGE_PATH = /^\/meet\/[A-Za-z0-9-]{1,60}\/?$/

/** { slug } for a booking link of this environment or a bare slug, else { error } (a failed result). */
function resolveBookingSlug(value) {
    const { slugify } = require('./bookingSettings')
    const raw = safeTrim(value)
    const usage = 'Pass the booking link, e.g. https://my.alldone.app/meet/<slug>, or its slug.'
    if (!raw) return { error: fail('invalid_booking_link', `bookingUrl is required. ${usage}`) }
    if (/^[A-Za-z0-9-]{1,60}$/.test(raw)) {
        const slug = slugify(raw)
        return slug ? { slug } : { error: fail('invalid_booking_link', usage) }
    }
    let url
    try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    } catch (_) {
        return { error: fail('invalid_booking_link', `This is not a link. ${usage}`) }
    }
    const allowedHosts = getAllowedBookingHosts()
    const host = url.host.toLowerCase()
    const isLocal = host.startsWith('localhost:')
    if (!allowedHosts.has(host) || (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:'))) {
        return {
            error: fail(
                'foreign_booking_link',
                `Only Alldone booking links of ${[...allowedHosts][0] || 'this Alldone app'} can be booked with this tool.`
            ),
        }
    }
    const match = url.pathname.match(BOOKING_PATH)
    if (!match) {
        return { error: fail('invalid_booking_link', `This is not an Alldone booking link. ${usage}`) }
    }
    return { slug: slugify(match[1]) }
}

/**
 * The booking page (/meet/<slug>) of this environment that `pageUrl` shows, as its canonical link, or
 * null. Only the page itself: an API route or any other Alldone page is not a page an agent clicks.
 */
function getBookingPageLinkFromUrl(pageUrl) {
    const raw = safeTrim(pageUrl)
    if (!raw) return null
    let url
    try {
        url = new URL(raw)
    } catch (_) {
        return null
    }
    if (!BOOKING_PAGE_PATH.test(url.pathname)) return null
    const resolved = resolveBookingSlug(`${url.protocol}//${url.host}${url.pathname}`)
    if (resolved.error || !resolved.slug) return null
    const { getBookingUrl } = require('./publicBooking')
    return getBookingUrl(resolved.slug)
}

const BOOKING_PAGE_TOOL_NAMES = ['get_public_booking_page', 'find_public_booking_times', 'book_public_meeting']

/**
 * AT-3161 follow-up. A connected agent whose tool list lacked the booking tools (a client still showing
 * the list from before they existed, or the tools switched off) opened the booking link with the
 * browser tools, then tried to click the page and stopped at the approval gate. A browser result for a
 * booking page now says which tools do the job and what to tell the user when they are missing.
 *
 * Only a COMPLETED step is annotated. A refused or approval-gated step is returned untouched: its
 * "stop and ask the user" instruction stands, and nothing here is a way around the browser's checks.
 * The booking tools have their own gate (explicit confirmation of the exact slot).
 */
function attachBookingPageBrowserHint(result, { toolName, toolArgs } = {}) {
    if (!result || typeof result !== 'object' || result.success !== true) return result
    const pageUrl =
        result.finalUrl || result.url || (toolName === 'browser_navigate' ? safeTrim(toolArgs?.url) : '') || ''
    const bookingUrl = getBookingPageLinkFromUrl(pageUrl)
    if (!bookingUrl) return result
    return {
        ...result,
        bookingPage: {
            bookingUrl,
            tools: BOOKING_PAGE_TOOL_NAMES,
            instruction:
                `This is an Alldone booking page. Do not click or fill it in. Use get_public_booking_page and ` +
                `find_public_booking_times with bookingUrl "${bookingUrl}" (they only read and need no confirmation), ` +
                'propose one slot with date, time and time zone, and call book_public_meeting only after the user ' +
                'confirmed exactly that slot. If these tools are not in your tool list, do not book in the browser: ' +
                'tell the user to refresh or reconnect the Alldone connector (or enable them under Settings → MCP; ' +
                'for an Alldone assistant under Tools Access).',
        },
    }
}

module.exports = {
    BOOKING_PAGE_TOOL_NAMES,
    attachBookingPageBrowserHint,
    getAllowedBookingHosts,
    getBookingPageLinkFromUrl,
    resolveBookingSlug,
}
