'use strict'

const admin = require('firebase-admin')
const moment = require('moment-timezone')
const { createCalendarEventForAssistantRequest } = require('../GoogleCalendar/assistantCalendarTools')
const {
    findPublicBookingSlots,
    getConnectedCalendarCount,
    getHostingUrl,
    getPublicBookingPage,
    resolvePublicDuration,
    slugify,
} = require('./bookingSettings')

function setCommonHeaders(res) {
    res.set('Cache-Control', 'no-store')
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, status, payload) {
    res.status(status).json(payload)
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
    return parsed.clone().tz(timeZone || 'UTC').format()
}

function slotMatchesOption(option, start, end, timeZone) {
    return normalizeSlotKey(option.start, timeZone) === normalizeSlotKey(start, timeZone) &&
        normalizeSlotKey(option.end, timeZone) === normalizeSlotKey(end, timeZone)
}

async function loadPublicPageOr404(res, slug) {
    const page = await getPublicBookingPage(slug)
    const connectedCalendarCount = page ? await getConnectedCalendarCount(page.userId) : 0
    if (!page || connectedCalendarCount === 0) {
        json(res, 404, { success: false, error: 'Booking page not found' })
        return null
    }
    return page
}

async function handleGetPage(req, res, slug) {
    const page = await loadPublicPageOr404(res, slug)
    if (!page) return

    json(res, 200, {
        success: true,
        page: {
            slug: page.slug,
            profile: page.profile,
            settings: {
                durationMinutes: page.settings.durationMinutes,
                availableDurations: page.settings.availableDurations,
                slotIntervalMinutes: page.settings.slotIntervalMinutes,
                workingHoursStart: page.settings.workingHoursStart,
                workingHoursEnd: page.settings.workingHoursEnd,
                includeWeekends: page.settings.includeWeekends,
                bufferBeforeMinutes: page.settings.bufferBeforeMinutes,
                bufferAfterMinutes: page.settings.bufferAfterMinutes,
                timeZone: page.settings.timeZone,
            },
        },
    })
}

async function handleGetSlots(req, res) {
    const slug = slugify(req.query?.slug)
    const start = safeTrim(req.query?.start)
    const end = safeTrim(req.query?.end)
    const timeZone = safeTrim(req.query?.timeZone)
    const durationMinutes = req.query?.durationMinutes

    if (!slug || !isValidIsoDateTime(start) || !isValidIsoDateTime(end)) {
        json(res, 400, { success: false, error: 'slug, start, and end are required' })
        return
    }

    const page = await loadPublicPageOr404(res, slug)
    if (!page) return

    const rangeStart = moment.parseZone(start)
    const rangeEnd = moment.parseZone(end)
    if (!rangeEnd.isAfter(rangeStart)) {
        json(res, 400, { success: false, error: 'end must be after start' })
        return
    }

    const slotsResult = await findPublicBookingSlots(page, { start, end, timeZone, durationMinutes })
    if (!slotsResult.success) {
        json(res, 409, {
            success: false,
            error: slotsResult.message || 'Calendar availability could not be checked',
            options: [],
        })
        return
    }

    json(res, 200, {
        success: true,
        timeZone: slotsResult.timeZone,
        durationMinutes: slotsResult.durationMinutes,
        options: slotsResult.options || [],
    })
}

function buildBookingDescription({ visitorName, visitorEmail, note, slug }) {
    const bookingUrl = `${getHostingUrl().replace(/\/+$/, '')}/meet/${slug}`
    const lines = [
        `Booked from Alldone.app public booking link: ${bookingUrl}`,
        `Visitor: ${visitorName} <${visitorEmail}>`,
    ]
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

async function assertSlotStillAvailable(page, { start, end, timeZone, durationMinutes }) {
    const slotStart = moment.parseZone(start)
    const resolvedDurationMinutes = resolvePublicDuration(page.settings, durationMinutes)
    if (!requestedRangeMatchesDuration({ start, end, durationMinutes: resolvedDurationMinutes })) return false
    const rangeStart = slotStart.clone().tz(timeZone || page.settings.timeZone || 'UTC').startOf('day').format()
    const rangeEnd = slotStart.clone().tz(timeZone || page.settings.timeZone || 'UTC').endOf('day').format()
    const result = await findPublicBookingSlots(page, {
        start: rangeStart,
        end: rangeEnd,
        timeZone: timeZone || page.settings.timeZone,
        durationMinutes: resolvedDurationMinutes,
    })
    return result.success && (result.options || []).some(option => slotMatchesOption(option, start, end, result.timeZone))
}

async function handleBook(req, res) {
    const body = parseBody(req)
    const slug = slugify(body.slug)
    const start = safeTrim(body.start)
    const end = safeTrim(body.end)
    const timeZone = safeTrim(body.timeZone)
    const durationMinutes = body.durationMinutes
    const visitorName = safeTrim(body.visitorName).slice(0, 120)
    const visitorEmail = normalizeEmail(body.visitorEmail)
    const note = safeTrim(body.note).slice(0, 2000)

    if (!slug || !isValidIsoDateTime(start) || !isValidIsoDateTime(end)) {
        json(res, 400, { success: false, error: 'slug, start, and end are required' })
        return
    }
    if (!visitorName || !isValidEmail(visitorEmail)) {
        json(res, 400, { success: false, error: 'Visitor name and a valid email are required' })
        return
    }
    if (!moment.parseZone(end).isAfter(moment.parseZone(start))) {
        json(res, 400, { success: false, error: 'end must be after start' })
        return
    }

    const page = await loadPublicPageOr404(res, slug)
    if (!page) return

    const resolvedDurationMinutes = resolvePublicDuration(page.settings, durationMinutes)
    const available = await assertSlotStillAvailable(page, {
        start,
        end,
        timeZone,
        durationMinutes: resolvedDurationMinutes,
    })
    if (!available) {
        json(res, 409, { success: false, error: 'This slot is no longer available' })
        return
    }

    const eventResult = await createCalendarEventForAssistantRequest({
        userId: page.userId,
        summary: `Meeting with ${visitorName}`,
        description: buildBookingDescription({ visitorName, visitorEmail, note, slug }),
        start,
        end,
        timeZone: timeZone || page.settings.timeZone,
        attendees: [{ email: visitorEmail, displayName: visitorName }],
    })

    if (!eventResult?.success) {
        json(res, 409, { success: false, error: eventResult?.message || 'Calendar event could not be created' })
        return
    }

    const bookingRef = admin.firestore().collection(`users/${page.userId}/bookings`).doc()
    await bookingRef.set({
        slug,
        status: 'confirmed',
        visitorName,
        visitorEmail,
        note,
        start,
        end,
        durationMinutes: resolvedDurationMinutes,
        timeZone: timeZone || page.settings.timeZone || '',
        event: {
            provider: eventResult.provider || 'google',
            calendarId: eventResult.calendarId || '',
            eventId: eventResult.event?.eventId || '',
            htmlLink: eventResult.event?.htmlLink || '',
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    json(res, 200, {
        success: true,
        bookingId: bookingRef.id,
        start,
        end,
        durationMinutes: resolvedDurationMinutes,
    })
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
            await handleGetPage(req, res, pageMatch.groups.slug)
            return
        }
        if (req.method === 'GET' && path === '/slots') {
            await handleGetSlots(req, res)
            return
        }
        if (req.method === 'POST' && path === '/book') {
            await handleBook(req, res)
            return
        }
        json(res, 404, { success: false, error: 'Not found' })
    } catch (error) {
        console.error('bookingApi: error', error)
        json(res, 500, { success: false, error: 'Internal error' })
    }
}

module.exports = {
    bookingApiHandler,
    buildBookingDescription,
    isValidEmail,
    slotMatchesOption,
}
