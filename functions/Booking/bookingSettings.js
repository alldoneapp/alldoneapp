'use strict'

const admin = require('firebase-admin')
const moment = require('moment-timezone')
const { getConnectedMicrosoftCalendarAccounts } = require('../Calendar/providers/microsoftCalendarProvider')
const {
    findCalendarAvailabilityForAssistantRequest,
    __private__: { getConnectedCalendarAccounts },
} = require('../GoogleCalendar/assistantCalendarTools')
const { FieldValue } = require('firebase-admin/firestore')

const DEFAULT_BOOKING_SETTINGS = {
    enabled: false,
    slug: '',
    durationMinutes: 30,
    availableDurations: [15, 30, 60],
    slotIntervalMinutes: 30,
    workingHoursStart: '09:00',
    workingHoursEnd: '17:00',
    includeWeekends: false,
    // Same-day bookings are off by default: a link handed out publicly should not let a
    // stranger drop a meeting into the host's day that already started. Hosts opt in.
    allowSameDayBooking: false,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    additionalGuestEmails: [],
}

const MAX_BOOKING_RANGE_DAYS = 31
const MAX_PUBLIC_SLOT_OPTIONS = 96
const ALLOWED_BOOKING_DURATIONS = [15, 30, 60]
const MAX_ADDITIONAL_GUESTS = 10
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getHostingUrl() {
    const configured = process.env.HOSTING_URL || process.env.FUNCTIONS_HOSTING_URL || ''
    if (configured) return configured
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    if (projectId === 'alldonestaging') return 'https://mystaging.alldone.app'
    return 'https://my.alldone.app'
}

function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function slugify(value) {
    return safeTrim(value)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')
        .slice(0, 60)
}

function isValidSlug(value) {
    return /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/.test(value)
}

function buildDefaultSlug(userData = {}) {
    return slugify(userData.displayName || userData.name || userData.email || 'meet')
}

function normalizeBoundedInteger(value, fallback, min, max) {
    const parsed = parseInt(value, 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(Math.max(parsed, min), max)
}

function normalizeClockTime(value, fallback) {
    const normalized = safeTrim(value) || fallback
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : fallback
}

function normalizeGuestEmails(value) {
    const rawList = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : []
    const seen = new Set()
    const result = []
    for (const entry of rawList) {
        const email = safeTrim(entry).toLowerCase()
        if (!email || seen.has(email) || !EMAIL_REGEX.test(email)) continue
        seen.add(email)
        result.push(email)
        if (result.length >= MAX_ADDITIONAL_GUESTS) break
    }
    return result
}

function normalizeAvailableDurations(value) {
    const source = Array.isArray(value) ? value : DEFAULT_BOOKING_SETTINGS.availableDurations
    const normalized = Array.from(
        new Set(
            source
                .map(duration => parseInt(duration, 10))
                .filter(duration => ALLOWED_BOOKING_DURATIONS.includes(duration))
        )
    ).sort((a, b) => a - b)

    return normalized.length > 0 ? normalized : [...DEFAULT_BOOKING_SETTINGS.availableDurations]
}

function resolveUserIanaTimeZone(userData = {}) {
    const candidates = [
        userData.timezone,
        userData.preferredTimezone,
        userData.timezoneOffset,
        userData.timezoneMinutes,
    ]
    for (const candidate of candidates) {
        const trimmed = safeTrim(candidate)
        if (trimmed && moment.tz.zone(trimmed)) return trimmed
    }
    return 'UTC'
}

function normalizeBookingSettings(input = {}, userData = {}) {
    const defaults = {
        ...DEFAULT_BOOKING_SETTINGS,
        slug: buildDefaultSlug(userData),
    }
    const slug = slugify(input.slug || defaults.slug)
    const workingHoursStart = normalizeClockTime(input.workingHoursStart, defaults.workingHoursStart)
    const workingHoursEnd = normalizeClockTime(input.workingHoursEnd, defaults.workingHoursEnd)
    const availableDurations = normalizeAvailableDurations(input.availableDurations)
    const durationMinutes = normalizeBoundedInteger(input.durationMinutes, defaults.durationMinutes, 5, 480)

    return {
        enabled: input.enabled === true,
        slug,
        durationMinutes: availableDurations.includes(durationMinutes) ? durationMinutes : availableDurations[0],
        availableDurations,
        slotIntervalMinutes: normalizeBoundedInteger(input.slotIntervalMinutes, defaults.slotIntervalMinutes, 5, 120),
        workingHoursStart,
        workingHoursEnd: workingHoursEnd > workingHoursStart ? workingHoursEnd : defaults.workingHoursEnd,
        includeWeekends: input.includeWeekends === true,
        // Strict `=== true` is what makes backward compatibility work: booking links saved
        // before this setting existed carry no field at all, so they read as false and keep
        // the no-same-day rule without any data migration.
        allowSameDayBooking: input.allowSameDayBooking === true,
        bufferBeforeMinutes: normalizeBoundedInteger(input.bufferBeforeMinutes, defaults.bufferBeforeMinutes, 0, 240),
        bufferAfterMinutes: normalizeBoundedInteger(input.bufferAfterMinutes, defaults.bufferAfterMinutes, 0, 240),
        additionalGuestEmails: normalizeGuestEmails(input.additionalGuestEmails),
        timeZone: moment.tz.zone(safeTrim(input.timeZone))
            ? safeTrim(input.timeZone)
            : resolveUserIanaTimeZone(userData),
    }
}

function validateBookingSettings(settings) {
    if (!settings.slug || !isValidSlug(settings.slug)) {
        throw new Error('Booking link must be 3-60 lowercase letters, numbers, or hyphens.')
    }
    if (settings.workingHoursEnd <= settings.workingHoursStart) {
        throw new Error('Working hours end must be after start.')
    }
    if (!Array.isArray(settings.availableDurations) || settings.availableDurations.length === 0) {
        throw new Error('Select at least one meeting duration.')
    }
}

function buildPublicProfile(userData = {}) {
    return {
        displayName: safeTrim(userData.displayName || userData.name) || 'Alldone user',
        photoURL: safeTrim(userData.photoURL || userData.photoURL300 || userData.photoURL50),
    }
}

function buildPublicBookingPage(userId, userData, settings) {
    return {
        userId,
        enabled: settings.enabled === true,
        slug: settings.slug,
        profile: buildPublicProfile(userData),
        settings: {
            durationMinutes: settings.durationMinutes,
            availableDurations: settings.availableDurations,
            slotIntervalMinutes: settings.slotIntervalMinutes,
            workingHoursStart: settings.workingHoursStart,
            workingHoursEnd: settings.workingHoursEnd,
            includeWeekends: settings.includeWeekends,
            allowSameDayBooking: settings.allowSameDayBooking === true,
            bufferBeforeMinutes: settings.bufferBeforeMinutes,
            bufferAfterMinutes: settings.bufferAfterMinutes,
            // Host-private: consumed server-side in handleBook to add fixed guests to the
            // event. Never returned to visitors (handleGetPage whitelists the fields it exposes).
            additionalGuestEmails: normalizeGuestEmails(settings.additionalGuestEmails),
            timeZone: resolveUserIanaTimeZone(userData),
        },
        updatedAt: FieldValue.serverTimestamp(),
    }
}

async function getConnectedCalendarCount(userId) {
    const [googleAccounts, microsoftAccounts] = await Promise.all([
        getConnectedCalendarAccounts(userId).catch(() => []),
        getConnectedMicrosoftCalendarAccounts(userId).catch(() => []),
    ])
    return googleAccounts.length + microsoftAccounts.length
}

async function getBookingSettings(userId) {
    const [userDoc, settingsDoc, connectedCalendarCount] = await Promise.all([
        admin.firestore().doc(`users/${userId}`).get(),
        admin.firestore().doc(`users/${userId}/bookingSettings/default`).get(),
        getConnectedCalendarCount(userId),
    ])
    if (!userDoc.exists) throw new Error('User not found')

    const userData = userDoc.data() || {}
    const settings = normalizeBookingSettings(settingsDoc.exists ? settingsDoc.data() : {}, userData)
    return {
        settings,
        connectedCalendarCount,
        publicUrl:
            settings.enabled && settings.slug ? `${getHostingUrl().replace(/\/+$/, '')}/meet/${settings.slug}` : '',
    }
}

async function saveBookingSettings(userId, input = {}) {
    const userRef = admin.firestore().doc(`users/${userId}`)
    const settingsRef = admin.firestore().doc(`users/${userId}/bookingSettings/default`)
    const userDoc = await userRef.get()
    if (!userDoc.exists) throw new Error('User not found')

    const userData = userDoc.data() || {}
    const settings = normalizeBookingSettings(input, userData)
    validateBookingSettings(settings)

    const connectedCalendarCount = await getConnectedCalendarCount(userId)
    if (settings.enabled && connectedCalendarCount === 0) {
        throw new Error('Connect at least one calendar before enabling your booking link.')
    }

    await admin.firestore().runTransaction(async transaction => {
        const currentSettingsDoc = await transaction.get(settingsRef)
        const currentSlug = slugify(currentSettingsDoc.exists ? currentSettingsDoc.data()?.slug : '')
        const newPageRef = admin.firestore().doc(`bookingPages/${settings.slug}`)
        const newPageDoc = await transaction.get(newPageRef)
        if (settings.enabled && newPageDoc.exists && newPageDoc.data()?.userId !== userId) {
            throw new Error('This booking link is already taken.')
        }

        if (currentSlug && currentSlug !== settings.slug) {
            transaction.delete(admin.firestore().doc(`bookingPages/${currentSlug}`))
        }
        if (!settings.enabled && currentSlug) {
            transaction.delete(admin.firestore().doc(`bookingPages/${currentSlug}`))
        }

        transaction.set(
            settingsRef,
            {
                ...settings,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        )

        if (settings.enabled) {
            transaction.set(newPageRef, buildPublicBookingPage(userId, userData, settings), { merge: true })
        }
    })

    return {
        settings,
        connectedCalendarCount,
        publicUrl:
            settings.enabled && settings.slug ? `${getHostingUrl().replace(/\/+$/, '')}/meet/${settings.slug}` : '',
    }
}

async function getPublicBookingPage(slug) {
    const normalizedSlug = slugify(slug)
    if (!normalizedSlug) return null
    const pageDoc = await admin.firestore().doc(`bookingPages/${normalizedSlug}`).get()
    if (!pageDoc.exists) return null
    const page = pageDoc.data() || {}
    if (page.enabled !== true || !page.userId) return null
    return {
        slug: normalizedSlug,
        userId: page.userId,
        profile: page.profile || {},
        settings: normalizeBookingSettings({ ...(page.settings || {}), enabled: true, slug: normalizedSlug }, {}),
    }
}

function resolvePublicDuration(settings = {}, durationMinutes) {
    const availableDurations = normalizeAvailableDurations(settings.availableDurations)
    const requestedDuration = parseInt(durationMinutes, 10)
    if (availableDurations.includes(requestedDuration)) return requestedDuration
    return availableDurations.includes(settings.durationMinutes) ? settings.durationMinutes : availableDurations[0]
}

// "Today" is the HOST's calendar day, not the visitor's. The host timezone already drives
// working hours and day boundaries everywhere else in this flow, and the rule expresses the
// host's intent ("nobody drops a meeting into the day I already planned"), so a visitor in a
// different timezone must not be able to shift it.
function resolveSameDayBoundaryTimeZone(settings = {}, requestedTimeZone) {
    const hostTimeZone = safeTrim(settings.timeZone)
    if (hostTimeZone && moment.tz.zone(hostTimeZone)) return hostTimeZone
    const requested = safeTrim(requestedTimeZone)
    if (requested && moment.tz.zone(requested)) return requested
    return 'UTC'
}

// Returns the first instant an external visitor may book, or null when there is no
// restriction. A missing/false allowSameDayBooking means midnight tomorrow in the host's
// timezone — so existing booking links (no such field) keep the no-same-day rule.
function resolveEarliestBookableStart(settings = {}, requestedTimeZone, now = undefined) {
    if (settings.allowSameDayBooking === true) return null
    const zone = resolveSameDayBoundaryTimeZone(settings, requestedTimeZone)
    return (now ? moment(now) : moment()).tz(zone).startOf('day').add(1, 'day')
}

async function findPublicBookingSlots(page, { start, end, timeZone, durationMinutes }) {
    const settings = page.settings || {}
    const resolvedDurationMinutes = resolvePublicDuration(settings, durationMinutes)
    const resolvedTimeZone = timeZone || settings.timeZone || 'UTC'

    // Single funnel: both GET /slots and the re-check inside POST /book come through here,
    // so clamping the search window is all the enforcement the same-day rule needs.
    let effectiveStart = start
    const earliestBookableStart = resolveEarliestBookableStart(settings, timeZone)
    if (earliestBookableStart) {
        const requestedEnd = moment.parseZone(end)
        if (requestedEnd.isValid() && !requestedEnd.isAfter(earliestBookableStart)) {
            // The whole requested window is today or earlier — nothing is bookable. Answer
            // with an empty success rather than an error: no availability is the truth here,
            // and a failure would surface to the visitor as a broken calendar.
            return {
                success: true,
                timeZone: resolvedTimeZone,
                durationMinutes: resolvedDurationMinutes,
                options: [],
                message: 'Same-day bookings are not available for this link.',
            }
        }
        const requestedStart = moment.parseZone(start)
        if (requestedStart.isValid() && requestedStart.isBefore(earliestBookableStart)) {
            effectiveStart = earliestBookableStart.format()
        }
    }

    const result = await findCalendarAvailabilityForAssistantRequest({
        userId: page.userId,
        timeMin: effectiveStart,
        timeMax: end,
        timeZone: resolvedTimeZone,
        durationMinutes: resolvedDurationMinutes,
        maxOptions: MAX_PUBLIC_SLOT_OPTIONS,
        // Start times are spaced by the meeting length so slots line up cleanly and
        // don't overlap. The slot interval is no longer a separate user-facing setting.
        slotIntervalMinutes: resolvedDurationMinutes,
        workingHoursStart: settings.workingHoursStart,
        workingHoursEnd: settings.workingHoursEnd,
        includeWeekends: settings.includeWeekends,
        bufferBeforeMinutes: settings.bufferBeforeMinutes,
        bufferAfterMinutes: settings.bufferAfterMinutes,
    })
    return { ...result, durationMinutes: resolvedDurationMinutes }
}

module.exports = {
    DEFAULT_BOOKING_SETTINGS,
    MAX_BOOKING_RANGE_DAYS,
    ALLOWED_BOOKING_DURATIONS,
    buildDefaultSlug,
    findPublicBookingSlots,
    getBookingSettings,
    getConnectedCalendarCount,
    getHostingUrl,
    getPublicBookingPage,
    normalizeBookingSettings,
    resolveEarliestBookableStart,
    resolvePublicDuration,
    resolveSameDayBoundaryTimeZone,
    saveBookingSettings,
    slugify,
    validateBookingSettings,
}
